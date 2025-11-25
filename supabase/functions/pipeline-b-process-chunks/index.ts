import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// Declare EdgeRuntime global for background task execution
declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TypeScript Interfaces - Based on Landing AI Official Documentation
// GET /v1/ade/parse/jobs/{job_id} Response Format
// ============================================================================

interface LandingAIGroundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LandingAIGrounding {
  box: LandingAIGroundingBox;
  page: number;
}

interface LandingAIChunk {
  markdown: string;          // REQUIRED - text content of the chunk
  type: string;              // REQUIRED - chunk type (text, table, list, code_block, header, etc.)
  id: string;                // REQUIRED - unique chunk identifier
  grounding?: LandingAIGrounding;  // OPTIONAL - visual location info
}

interface LandingAIJobResponse {
  job_id: string;
  status: string;
  data?: {
    chunks: LandingAIChunk[];
    metadata?: any;
  };
  metadata?: {
    filename: string;
    page_count: number;
  };
}

// ============================================================================
// FUNCTION: createLandingAIParseJob - Create new Parse Job
// ============================================================================

async function createLandingAIParseJob(
  content: Blob,
  fileName: string
): Promise<string> {
  const landingApiKey = Deno.env.get('LANDING_AI_API_KEY');
  if (!landingApiKey) {
    throw new Error('LANDING_AI_API_KEY not configured');
  }

  console.log(`🚀 [Landing AI] Creating new Parse Job for: ${fileName}`);
  const formData = new FormData();
  formData.append('document', content, fileName);

  const response = await fetch('https://api.va.landing.ai/v1/ade/parse/jobs', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${landingApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [Landing AI] Job creation failed: ${response.status}`);
    console.error(`❌ [Landing AI] Error: ${errorText}`);
    throw new Error(`Landing AI Parse Job creation failed: ${response.status}`);
  }

  const result = await response.json();
  const jobId = result.job_id;

  if (!jobId) {
    console.error('❌ [Landing AI] No job_id in response:', result);
    throw new Error('Landing AI did not return job_id');
  }

  console.log(`✓ [Landing AI] Job created: ${jobId}`);
  return jobId;
}

// ============================================================================
// FUNCTION: pollJobUntilComplete - Poll job status until ready
// ============================================================================

async function pollJobUntilComplete(jobId: string, maxAttempts = 30): Promise<void> {
  const landingApiKey = Deno.env.get('LANDING_AI_API_KEY')!;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`⏳ [Landing AI] Polling job ${jobId} (attempt ${attempt}/${maxAttempts})...`);
    
    const response = await fetch(`https://api.va.landing.ai/v1/ade/parse/jobs/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${landingApiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Job status check failed: ${response.status}`);
    }

    const result = await response.json();
    const status = result.status;

    console.log(`📊 [Landing AI] Job status: ${status}`);

    if (status === 'completed') {
      console.log(`✅ [Landing AI] Job completed successfully`);
      return;
    }

    if (status === 'failed') {
      throw new Error(`Landing AI job failed: ${result.error_message || 'Unknown error'}`);
    }

    // Wait 2 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error(`Job polling timeout after ${maxAttempts} attempts`);
}

// ============================================================================
// FUNCTION: retrieveJobChunks - Get chunks from completed job
// ============================================================================

async function retrieveJobChunks(jobId: string): Promise<LandingAIChunk[]> {
  const landingApiKey = Deno.env.get('LANDING_AI_API_KEY')!;
  
  console.log(`📥 [Landing AI] Retrieving chunks from job: ${jobId}`);
  
  // Use official GET /v1/ade/parse/jobs/{job_id} endpoint
  const response = await fetch(
    `https://api.va.landing.ai/v1/ade/parse/jobs/${jobId}`,
    { headers: { 'Authorization': `Bearer ${landingApiKey}` } }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to retrieve job results: ${response.status} - ${errorText}`);
  }

  const jobResult: LandingAIJobResponse = await response.json();
  
  // Validate job completed successfully
  if (jobResult.status !== 'completed') {
    throw new Error(`Job not completed. Status: ${jobResult.status}`);
  }

  // Extract chunks from data.chunks (per official documentation)
  const chunks = jobResult.data?.chunks;
  
  if (!chunks || !Array.isArray(chunks)) {
    console.error('❌ [Landing AI] Invalid response structure:', jobResult);
    throw new Error('Landing AI response missing data.chunks array');
  }

  console.log(`📄 [Landing AI] Retrieved ${chunks.length} chunks`);
  
  // Log first 3 chunks for debugging
  if (chunks.length > 0) {
    console.log('📄 [Landing AI] Sample chunks:');
    chunks.slice(0, 3).forEach((chunk, i) => {
      console.log(`\nChunk ${i}:`, {
        markdown_length: chunk.markdown?.length || 0,
        type: chunk.type,
        id: chunk.id,
        has_grounding: !!chunk.grounding,
        grounding_page: chunk.grounding?.page,
      });
    });
  }

  // Validate chunks have required fields (markdown, type, id)
  const validChunks: LandingAIChunk[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    // Validate required fields per documentation
    if (!chunk.markdown || typeof chunk.markdown !== 'string') {
      console.warn(`⚠️ [Landing AI] Chunk ${i} missing/invalid markdown field, skipping`);
      continue;
    }
    
    if (!chunk.type || typeof chunk.type !== 'string') {
      console.warn(`⚠️ [Landing AI] Chunk ${i} missing type field, skipping`);
      continue;
    }
    
    if (!chunk.id || typeof chunk.id !== 'string') {
      console.warn(`⚠️ [Landing AI] Chunk ${i} missing id field, skipping`);
      continue;
    }
    
    // grounding is optional - just log if missing
    if (!chunk.grounding) {
      console.log(`ℹ️ [Landing AI] Chunk ${i} has no grounding (optional)`);
    }
    
    validChunks.push(chunk);
  }
  
  console.log(`✅ [Landing AI] Validated ${validChunks.length}/${chunks.length} chunks`);
  
  if (validChunks.length === 0) {
    throw new Error('No valid chunks found after validation');
  }
  
  return validChunks;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔄 Pipeline B Process Chunks - Starting...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse body to check for event-driven mode (single documentId)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const targetDocumentId = body.documentId;

    let documents;
    
    if (targetDocumentId) {
      // 🎯 EVENT-DRIVEN MODE: Process single document
      console.log(`🎯 Event-driven mode: processing single document ${targetDocumentId}`);
      const { data, error: fetchError } = await supabase
        .from('pipeline_b_documents')
        .select('*')
        .eq('id', targetDocumentId)
        .eq('status', 'ingested')
        .single();

      if (fetchError) throw fetchError;
      documents = data ? [data] : [];
      
    } else {
      // 📦 CRON/FALLBACK MODE: Process batch
      console.log(`📦 Cron mode: processing batch of documents`);
      const { data, error: fetchError } = await supabase
        .from('pipeline_b_documents')
        .select('*')
        .eq('status', 'ingested')
        .limit(5);

      if (fetchError) throw fetchError;
      documents = data || [];
    }

    if (!documents || documents.length === 0) {
      console.log('✓ No documents to process');
      return new Response(
        JSON.stringify({ message: 'No documents pending processing' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Processing ${documents.length} documents`);

    const results = {
      processed: 0,
      failed: 0,
      errors: [] as Array<{ id: string; error: string }>,
    };

    for (const doc of documents) {
      try {
        console.log(`\n📄 Processing: ${doc.file_name}`);

        // Check if document already has chunks (prevent duplicates)
        const { data: existingChunks } = await supabase
          .from('pipeline_b_chunks_raw')
          .select('id')
          .eq('document_id', doc.id)
          .limit(1);

        if (existingChunks && existingChunks.length > 0) {
          console.log(`⏭️  Skipping ${doc.file_name} - already has chunks`);
          
          // Update status to 'chunked' if stuck in 'ingested'
          await supabase
            .from('pipeline_b_documents')
            .update({ status: 'chunked' })
            .eq('id', doc.id);
          
          continue; // Skip to next document
        }

        // Mark as processing
        await supabase
          .from('pipeline_b_documents')
          .update({ status: 'processing' })
          .eq('id', doc.id);

        let content: Blob;

        // Get content based on source type
        if (doc.source_type === 'pdf') {
          // Download PDF from storage
          const { data: fileData, error: downloadError } = await supabase.storage
            .from(doc.storage_bucket)
            .download(doc.file_path);

          if (downloadError) throw downloadError;
          content = fileData;

        } else if (doc.source_type === 'github' || doc.source_type === 'text') {
          // Convert full_text to Blob
          content = new Blob([doc.full_text], { type: 'text/plain' });

        } else {
          throw new Error(`Unsupported source_type: ${doc.source_type}`);
        }

        // Create new Landing AI Parse Job
        const jobId = await createLandingAIParseJob(content, doc.file_name);
        
        // Poll until complete
        await pollJobUntilComplete(jobId);

        // Retrieve chunks from completed job
        const landingChunks = await retrieveJobChunks(jobId);
        console.log(`✓ Retrieved ${landingChunks.length} validated chunks from job ${jobId}`);

        // Map Landing AI chunks to database format
        const chunksToInsert = landingChunks.map((chunk, index) => ({
          document_id: doc.id,
          content: chunk.markdown,              // ✅ Correct field name
          chunk_type: chunk.type,                // ✅ Correct field name
          chunk_index: index,
          chunk_id: chunk.id,                    // ✅ Separate column
          visual_grounding: chunk.grounding || null,  // ✅ Correct column name
          page_number: chunk.grounding?.page || null,  // ✅ Not array
          embedding_status: 'pending',
        }));

        const { error: insertError } = await supabase
          .from('pipeline_b_chunks_raw')
          .insert(chunksToInsert);

        if (insertError) throw insertError;

        // Mark document as chunked
        await supabase
          .from('pipeline_b_documents')
          .update({
            status: 'chunked',
            processed_at: new Date().toISOString(),
          })
          .eq('id', doc.id);

        console.log(`✓ Created ${landingChunks.length} chunks for ${doc.file_name}`);
        results.processed++;

        // 🚀 EVENT-DRIVEN: Invoke generate-embeddings immediately (only in event-driven mode)
        if (targetDocumentId) {
          console.log(`🚀 Triggering immediate embedding generation for document: ${doc.id}`);
          EdgeRuntime.waitUntil(
            supabase.functions.invoke('pipeline-b-generate-embeddings', {
              body: { documentId: doc.id }
            })
            .then(response => {
              if (response.error) {
                console.error(`❌ Background generate-embeddings failed:`, response.error);
              } else {
                console.log(`✅ Background generate-embeddings completed for ${doc.id}`);
              }
            })
            .catch(err => {
              console.error(`❌ Background generate-embeddings error:`, err);
            })
          );
        }

      } catch (error) {
        console.error(`❌ Failed to process ${doc.file_name}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Mark as failed
        await supabase
          .from('pipeline_b_documents')
          .update({
            status: 'failed',
            error_message: errorMessage,
          })
          .eq('id', doc.id);

        results.failed++;
        results.errors.push({ id: doc.id, error: errorMessage });
      }
    }

    console.log(`\n✅ Processing complete:`);
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Failed: ${results.failed}`);

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Pipeline B Process Chunks error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
