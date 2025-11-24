import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { generateEmbeddingsBatch, validateEmbedding } from "../_shared/embeddingService.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LandingAIChunk {
  text: string;
  chunk_type: string;
  chunk_references?: {
    page?: number;
    grounding?: Array<{ x: number; y: number; width: number; height: number }>;
  };
}

interface ProcessingStats {
  totalDocuments: number;
  processed: number;
  failed: number;
  chunksCreated: number;
  errors: Array<{ documentId: string; fileName: string; error: string }>;
}

async function extractWithLandingAI(fullText: string, fileName: string): Promise<LandingAIChunk[]> {
  const landingApiKey = Deno.env.get('LANDING_AI_API_KEY');
  if (!landingApiKey) {
    throw new Error('LANDING_AI_API_KEY not configured');
  }

  // Convert full_text to Blob/File for Landing AI
  const textBlob = new Blob([fullText], { type: 'text/plain' });
  const formData = new FormData();
  formData.append('file', textBlob, fileName);

  const response = await fetch('https://api.va.landing.ai/v1/ade/parse', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${landingApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Landing AI extraction failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result.chunks || [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { batchSize = 50, folder = null } = await req.json();
    
    console.log('========== PROCESS GITHUB BATCH START ==========');
    console.log(`Batch size: ${batchSize}, Folder filter: ${folder || 'all'}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch documents to process (pending_processing = ready for chunking)
    let query = supabase
      .from('knowledge_documents')
      .select('id, file_name, full_text, folder')
      .eq('processing_status', 'pending_processing')
      .not('full_text', 'is', null)
      .limit(batchSize);

    if (folder) {
      // Use LIKE to include subfolders (e.g., "Lovablelabs/Docs" matches "Lovablelabs/Docs/features")
      query = query.like('folder', `${folder}%`);
    }

    const { data: documents, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch documents: ${fetchError.message}`);
    }

    if (!documents || documents.length === 0) {
      console.log('No documents to process');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No documents to process',
          stats: { totalDocuments: 0, processed: 0, failed: 0, chunksCreated: 0, errors: [] }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📄 Found ${documents.length} documents to process`);

    const stats: ProcessingStats = {
      totalDocuments: documents.length,
      processed: 0,
      failed: 0,
      chunksCreated: 0,
      errors: [],
    };

    // Process documents with parallel processing
    const processDocument = async (doc: any) => {
      try {
        console.log(`\n🔄 Processing: ${doc.file_name} (${doc.id})`);
        
        // Update status to processing
        await supabase
          .from('knowledge_documents')
          .update({ processing_status: 'processing' })
          .eq('id', doc.id);

        await supabase
          .from('document_processing_cache')
          .upsert({
            document_id: doc.id,
            processing_started_at: new Date().toISOString(),
          });

        // Step 1: Extract chunks with Landing AI
        console.log(`🚀 Calling Landing AI for ${doc.file_name}...`);
        const landingChunks = await extractWithLandingAI(doc.full_text, doc.file_name);
        console.log(`✓ Landing AI returned ${landingChunks.length} chunks`);

        if (landingChunks.length === 0) {
          throw new Error('No chunks created by Landing AI');
        }

        // Step 2: Generate embeddings
        console.log(`🧮 Generating embeddings...`);
        const texts = landingChunks.map(c => c.text);
        
        const { successes: embeddings, failures } = await generateEmbeddingsBatch(
          texts,
          openaiKey,
          10,
          (completed, total) => {
            if (completed % 10 === 0 || completed === total) {
              console.log(`  Progress: ${completed}/${total} embeddings`);
            }
          }
        );

        if (failures.length > 0) {
          console.warn(`⚠️ ${failures.length} embeddings failed`);
          failures.forEach(f => console.warn(`  - ${f.error}`));
        }

        if (embeddings.length === 0) {
          throw new Error('No embeddings generated');
        }

        console.log(`✓ Generated ${embeddings.length} embeddings`);

        // Step 3: Insert chunks into agent_knowledge (shared pool)
        console.log(`💾 Inserting chunks into database...`);
        
        const chunksToInsert = embeddings.map((emb, index) => {
          const chunk = landingChunks[index];
          
          // Validate embedding
          const embValidation = validateEmbedding(emb.embedding);
          if (!embValidation.valid) {
            console.warn(`⚠️ Invalid embedding for chunk ${index}: ${embValidation.reason}`);
            return null;
          }

          return {
            agent_id: null, // Shared pool
            pool_document_id: doc.id,
            document_name: doc.file_name,
            content: chunk.text,
            category: doc.folder || 'GitHub',
            summary: null,
            embedding: JSON.stringify(emb.embedding),
            source_type: 'shared_pool',
            chunk_type: chunk.chunk_type,
            chunking_metadata: {
              chunk_type: chunk.chunk_type,
              page: chunk.chunk_references?.page,
              visual_grounding: chunk.chunk_references?.grounding,
            },
            is_active: true,
          };
        }).filter(Boolean);

        if (chunksToInsert.length === 0) {
          throw new Error('No valid chunks to insert');
        }

        // Insert in batches
        const CHUNK_INSERT_BATCH = 50;
        let insertedCount = 0;

        for (let i = 0; i < chunksToInsert.length; i += CHUNK_INSERT_BATCH) {
          const batch = chunksToInsert.slice(i, i + CHUNK_INSERT_BATCH);
          
          const { error: insertError } = await supabase
            .from('agent_knowledge')
            .insert(batch);

          if (insertError) {
            throw new Error(`Failed to insert chunks: ${insertError.message}`);
          }

          insertedCount += batch.length;
          console.log(`  Inserted ${insertedCount}/${chunksToInsert.length} chunks`);
        }

        // Step 4: Verify chunks were created
        const { count: verifyCount, error: verifyError } = await supabase
          .from('agent_knowledge')
          .select('*', { count: 'exact', head: true })
          .eq('pool_document_id', doc.id)
          .is('agent_id', null)
          .eq('is_active', true);

        if (verifyError) {
          throw new Error(`Failed to verify chunks: ${verifyError.message}`);
        }

        if (!verifyCount || verifyCount === 0) {
          throw new Error('Chunk verification failed: no chunks found in database');
        }

        console.log(`✅ Verified ${verifyCount} chunks in database`);

        // Step 5: Update document status to ready_for_assignment
        const { error: updateError } = await supabase
          .from('knowledge_documents')
          .update({
            processing_status: 'ready_for_assignment',
            validation_status: 'validated',
            processed_at: new Date().toISOString(),
          })
          .eq('id', doc.id);

        if (updateError) {
          throw new Error(`Failed to update status: ${updateError.message}`);
        }

        // Update cache
        await supabase
          .from('document_processing_cache')
          .update({
            processing_completed_at: new Date().toISOString(),
            total_chunks: verifyCount,
            processed_chunks: verifyCount,
          })
          .eq('document_id', doc.id);

        // Step 6: Generate AI metadata (summary, keywords, topics, complexity)
        console.log(`🤖 Generating AI metadata for ${doc.file_name}...`);
        try {
          const { error: aiError } = await supabase.functions.invoke('process-document', {
            body: {
              documentId: doc.id,
              fullText: doc.full_text,
              forceRegenerate: true, // Force AI generation
            }
          });

          if (aiError) {
            console.warn(`⚠️ AI metadata generation failed for ${doc.file_name}:`, aiError);
            // Don't throw - document is already chunked and functional
          } else {
            console.log(`✅ AI metadata generated for ${doc.file_name}`);
          }
        } catch (aiError) {
          console.warn(`⚠️ AI metadata generation error:`, aiError);
          // Continue processing - chunks are already created
        }

        return {
          success: true,
          documentId: doc.id,
          fileName: doc.file_name,
          chunksCreated: verifyCount || 0,
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed to process ${doc.file_name}:`, errorMessage);

        // Mark document as failed
        await supabase
          .from('knowledge_documents')
          .update({
            processing_status: 'processing_failed',
            validation_reason: errorMessage,
          })
          .eq('id', doc.id);

        await supabase
          .from('document_processing_cache')
          .update({
            error_message: errorMessage,
            processing_completed_at: new Date().toISOString(),
          })
          .eq('document_id', doc.id);

        return {
          success: false,
          documentId: doc.id,
          fileName: doc.file_name,
          error: errorMessage,
        };
      }
    };

    // Process documents in parallel (5 at a time to avoid overwhelming API)
    const PARALLEL_LIMIT = 5;
    const results = [];
    
    for (let i = 0; i < documents.length; i += PARALLEL_LIMIT) {
      const batch = documents.slice(i, i + PARALLEL_LIMIT);
      console.log(`\n📦 Processing batch ${Math.floor(i / PARALLEL_LIMIT) + 1} (${batch.length} documents)`);
      
      const batchResults = await Promise.all(batch.map(processDocument));
      results.push(...batchResults);
      
      // Small delay between batches to avoid rate limiting
      if (i + PARALLEL_LIMIT < documents.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Calculate stats from results
    results.forEach(result => {
      if (result.success) {
        stats.processed++;
        stats.chunksCreated += result.chunksCreated || 0;
      } else {
        stats.failed++;
        stats.errors.push({
          documentId: result.documentId,
          fileName: result.fileName,
          error: result.error || 'Unknown error',
        });
      }
    });

    console.log('\n========== PROCESS GITHUB BATCH COMPLETE ==========');
    console.log(`Total: ${stats.totalDocuments} | Processed: ${stats.processed} | Failed: ${stats.failed}`);
    console.log(`Chunks created: ${stats.chunksCreated}`);

    if (stats.errors.length > 0) {
      console.log('\n❌ Errors:');
      stats.errors.forEach(e => console.log(`  - ${e.fileName}: ${e.error}`));
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats,
        message: `Processed ${stats.processed}/${stats.totalDocuments} documents successfully`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ FATAL ERROR:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
