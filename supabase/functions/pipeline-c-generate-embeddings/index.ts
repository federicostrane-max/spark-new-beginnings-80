import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if this is an event-driven invocation (specific documentId)
    const body = await req.json().catch(() => ({}));
    const targetDocumentId = body?.documentId;

    if (targetDocumentId) {
      console.log(`[Pipeline C Embeddings] Event-driven mode: processing document ${targetDocumentId}`);
    } else {
      console.log('[Pipeline C Embeddings] Cron mode: processing batch');
    }

    console.log('[Pipeline C Embeddings] Starting embedding generation cycle');

    // Status reconciliation: find documents stuck in intermediate states
    const { data: stuckDocs, error: stuckError } = await supabase
      .from('pipeline_c_documents')
      .select('id, status')
      .not('status', 'in', '(ready,failed)');

    if (!stuckError && stuckDocs && stuckDocs.length > 0) {
      console.log(`[Pipeline C Embeddings] Reconciling ${stuckDocs.length} documents`);
      
      for (const doc of stuckDocs) {
        // First check if document has ANY chunks
        const { data: allChunks } = await supabase
          .from('pipeline_c_chunks_raw')
          .select('id')
          .eq('document_id', doc.id)
          .limit(1);

        // CRITICAL FIX: If document is in advanced state (chunked/processing) but has NO chunks
        // This is an inconsistent state - reset to 'ingested' for reprocessing
        if (!allChunks || allChunks.length === 0) {
          if (doc.status === 'chunked' || doc.status === 'processing') {
            console.log(`[Pipeline C Embeddings] ⚠️ Document ${doc.id} in status '${doc.status}' but has 0 chunks - resetting to 'ingested'`);
            
            await supabase
              .from('pipeline_c_documents')
              .update({ 
                status: 'ingested', 
                error_message: null,
                updated_at: new Date().toISOString()
              })
              .eq('id', doc.id);
          } else {
            console.log(`[Pipeline C Embeddings] Document ${doc.id} in status '${doc.status}' has no chunks yet, skipping reconciliation`);
          }
          continue;
        }

        // Document has chunks - check if any are pending embedding
        const { data: pendingChunks } = await supabase
          .from('pipeline_c_chunks_raw')
          .select('id')
          .eq('document_id', doc.id)
          .neq('embedding_status', 'ready')
          .limit(1);

        // If all chunks are ready (no pending), mark document ready
        if (!pendingChunks || pendingChunks.length === 0) {
          await supabase
            .from('pipeline_c_documents')
            .update({ status: 'ready', processed_at: new Date().toISOString() })
            .eq('id', doc.id);
          
          console.log(`[Pipeline C Embeddings] ✅ Reconciled document ${doc.id} to ready`);
        }
      }
    }

    // Get chunks pending embedding
    let chunksQuery = supabase
      .from('pipeline_c_chunks_raw')
      .select('id, content, document_id')
      .eq('embedding_status', 'pending');

    if (targetDocumentId) {
      // Event-driven: process only chunks for the specified document
      chunksQuery = chunksQuery.eq('document_id', targetDocumentId);
    } else {
      // Cron mode: process batch (max 50)
      chunksQuery = chunksQuery.limit(50);
    }

    const { data: chunks, error: chunksError } = await chunksQuery;

    if (chunksError) {
      console.error('[Pipeline C Embeddings] Error fetching chunks:', chunksError);
      return new Response(
        JSON.stringify({ error: chunksError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!chunks || chunks.length === 0) {
      console.log('[Pipeline C Embeddings] No pending chunks found');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No pending chunks to process',
          chunksProcessed: 0 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline C Embeddings] Processing ${chunks.length} chunks`);

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    let successCount = 0;
    let failCount = 0;
    const processedDocIds = new Set<string>();

    // Process chunks in batches with rate limiting
    for (const chunk of chunks) {
      try {
        // Mark as processing
        await supabase
          .from('pipeline_c_chunks_raw')
          .update({ embedding_status: 'processing' })
          .eq('id', chunk.id);

        // Generate embedding
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: chunk.content,
          }),
        });

        if (!embeddingResponse.ok) {
          const errorText = await embeddingResponse.text();
          throw new Error(`OpenAI API error: ${embeddingResponse.status} - ${errorText}`);
        }

        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data[0].embedding;

        // Validate embedding
        if (!Array.isArray(embedding) || embedding.length !== 1536) {
          throw new Error('Invalid embedding dimension');
        }

        // Update chunk with embedding
        const { error: updateError } = await supabase
          .from('pipeline_c_chunks_raw')
          .update({
            embedding: JSON.stringify(embedding),
            embedding_status: 'ready',
            embedded_at: new Date().toISOString(),
            embedding_error: null,
          })
          .eq('id', chunk.id);

        if (updateError) {
          throw updateError;
        }

        successCount++;
        processedDocIds.add(chunk.document_id);
        
        // Rate limiting: 100ms delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[Pipeline C Embeddings] Error processing chunk ${chunk.id}:`, error);
        
        await supabase
          .from('pipeline_c_chunks_raw')
          .update({
            embedding_status: 'failed',
            embedding_error: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', chunk.id);

        failCount++;
      }
    }

    console.log(`[Pipeline C Embeddings] Processed: ${successCount} success, ${failCount} failed`);

    // Update document status for successfully processed documents
    for (const docId of processedDocIds) {
      const { data: pendingChunks } = await supabase
        .from('pipeline_c_chunks_raw')
        .select('id')
        .eq('document_id', docId)
        .neq('embedding_status', 'ready')
        .limit(1);

      if (!pendingChunks || pendingChunks.length === 0) {
        await supabase
          .from('pipeline_c_documents')
          .update({ 
            status: 'ready',
            processed_at: new Date().toISOString()
          })
          .eq('id', docId);
        
        console.log(`[Pipeline C Embeddings] Document ${docId} marked as ready`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        chunksProcessed: chunks.length,
        successCount,
        failCount,
        documentsUpdated: processedDocIds.size,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline C Embeddings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
