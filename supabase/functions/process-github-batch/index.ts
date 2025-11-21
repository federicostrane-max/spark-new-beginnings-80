import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { chunkText, validateChunk, type TextChunk } from "../_shared/chunkingService.ts";
import { generateEmbeddingsBatch, validateEmbedding } from "../_shared/embeddingService.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessingStats {
  totalDocuments: number;
  processed: number;
  failed: number;
  chunksCreated: number;
  errors: Array<{ documentId: string; fileName: string; error: string }>;
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

    // Fetch documents to process
    let query = supabase
      .from('knowledge_documents')
      .select('id, file_name, full_text, folder')
      .eq('processing_status', 'pending_processing')
      .not('full_text', 'is', null)
      .limit(batchSize);

    if (folder) {
      query = query.eq('folder', folder);
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

    // Process each document
    for (const doc of documents) {
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

        // Step 1: Create chunks
        console.log(`📝 Creating chunks for ${doc.file_name}...`);
        const chunks = chunkText(doc.full_text, 1000, 200);
        console.log(`✓ Created ${chunks.length} chunks`);

        // Validate chunks
        const validChunks = chunks.filter(chunk => {
          const validation = validateChunk(chunk);
          if (!validation.valid) {
            console.warn(`⚠️ Invalid chunk ${chunk.metadata.chunkIndex}: ${validation.reason}`);
            return false;
          }
          return true;
        });

        if (validChunks.length === 0) {
          throw new Error('No valid chunks created');
        }

        console.log(`✓ ${validChunks.length} valid chunks`);

        // Step 2: Generate embeddings
        console.log(`🧮 Generating embeddings...`);
        const texts = validChunks.map(c => c.content);
        
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
          const chunk = validChunks[index];
          
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
            content: chunk.content,
            category: doc.folder || 'GitHub',
            summary: null,
            embedding: JSON.stringify(emb.embedding),
            source_type: 'shared_pool',
            chunking_metadata: chunk.metadata,
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

        stats.processed++;
        stats.chunksCreated += verifyCount;
        console.log(`✅ Successfully processed ${doc.file_name}`);

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

        stats.failed++;
        stats.errors.push({
          documentId: doc.id,
          fileName: doc.file_name,
          error: errorMessage,
        });
      }
    }

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
