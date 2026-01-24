import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 20;
const RATE_LIMIT_DELAY = 100;

/**
 * Build embedding input with heading context
 * The heading hierarchy provides semantic context for chunks
 * that would otherwise be just numbers or lists
 */
function buildEmbeddingInput(chunk: any): string {
  // Extract heading hierarchy if available
  const headings = chunk.heading_hierarchy || {};
  const headingParts = [headings.h1, headings.h2, headings.h3].filter(Boolean);
  
  // If we have heading context, prepend it to the content
  if (headingParts.length > 0) {
    const headingContext = headingParts.join(' > ');
    return `${headingContext}\n\n${chunk.content}`;
  }
  
  return chunk.content;
}

/**
 * Retry with exponential backoff for API calls
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 500,
  context: string = 'API call'
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[${context}] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Should not reach here');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const documentId = body.documentId;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    console.log('[Pipeline A Embeddings] Starting embedding generation...');

    // ============================================================
    // STUCK CHUNK RECOVERY: Reset chunks stuck in 'failed' for >10 minutes
    // This allows automatic retry for transient errors (API timeouts, rate limits)
    // ============================================================
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: failedChunks } = await supabase
      .from('pipeline_a_chunks_raw')
      .select('id, document_id')
      .eq('embedding_status', 'failed')
      .lt('updated_at', tenMinutesAgo)
      .limit(50);

    if (failedChunks && failedChunks.length > 0) {
      console.log(`[Pipeline A Embeddings] Found ${failedChunks.length} failed chunks older than 10 min, resetting to pending for retry`);

      for (const chunk of failedChunks) {
        await supabase
          .from('pipeline_a_chunks_raw')
          .update({
            embedding_status: 'pending',
            embedding_error: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', chunk.id);
      }
    }

    // Status reconciliation: fix stuck documents
    const { data: stuckDocs } = await supabase
      .from('pipeline_a_documents')
      .select('id, status')
      .in('status', ['ingested', 'chunked', 'processing'])
      .neq('status', 'ready')
      .neq('status', 'failed');

    if (stuckDocs && stuckDocs.length > 0) {
      for (const doc of stuckDocs) {
        const { data: chunks } = await supabase
          .from('pipeline_a_chunks_raw')
          .select('id, embedding_status')
          .eq('document_id', doc.id);

        if (!chunks || chunks.length === 0) {
          // Document in chunked/processing state but has no chunks - reset to ingested
          if (doc.status === 'chunked' || doc.status === 'processing') {
            await supabase
              .from('pipeline_a_documents')
              .update({ status: 'ingested', updated_at: new Date().toISOString() })
              .eq('id', doc.id);
            console.log(`[Pipeline A Embeddings] Reset document ${doc.id} to 'ingested' (no chunks)`);
          }
        } else {
          const allReady = chunks.every(c => c.embedding_status === 'ready');
          const allFailed = chunks.every(c => c.embedding_status === 'failed');

          if (allReady) {
            await supabase
              .from('pipeline_a_documents')
              .update({ status: 'ready', updated_at: new Date().toISOString() })
              .eq('id', doc.id);
            console.log(`[Pipeline A Embeddings] Reconciled document ${doc.id} to 'ready'`);
          } else if (allFailed) {
            // All chunks failed - mark document as failed
            await supabase
              .from('pipeline_a_documents')
              .update({
                status: 'failed',
                error_message: 'All chunks failed embedding generation',
                updated_at: new Date().toISOString()
              })
              .eq('id', doc.id);
            console.log(`[Pipeline A Embeddings] Marked document ${doc.id} as 'failed' (all chunks failed)`);
          }
        }
      }
    }

    // Fetch chunks to process
    let query = supabase
      .from('pipeline_a_chunks_raw')
      .select('*')
      .eq('embedding_status', 'pending')
      .order('created_at', { ascending: true });

    if (documentId) {
      query = query.eq('document_id', documentId);
      console.log(`[Pipeline A Embeddings] Event-driven mode: document ${documentId}`);
    } else {
      query = query.limit(BATCH_SIZE);
      console.log(`[Pipeline A Embeddings] Cron mode: up to ${BATCH_SIZE} chunks`);
    }

    const { data: chunks, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch chunks: ${fetchError.message}`);
    }

    if (!chunks || chunks.length === 0) {
      console.log('[Pipeline A Embeddings] No chunks to process');
      return new Response(
        JSON.stringify({ success: true, message: 'No chunks to process' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline A Embeddings] Processing ${chunks.length} chunks`);

    let processed = 0;
    let failed = 0;

    for (const chunk of chunks) {
      try {
        await supabase
          .from('pipeline_a_chunks_raw')
          .update({ embedding_status: 'processing' })
          .eq('id', chunk.id);

        // Build embedding input with heading context
        const textToEmbed = buildEmbeddingInput(chunk);
        const hasHeadingContext = chunk.heading_hierarchy && 
          (chunk.heading_hierarchy.h1 || chunk.heading_hierarchy.h2 || chunk.heading_hierarchy.h3);
        console.log(`[Pipeline A Embeddings] Embedding chunk ${chunk.id}: ${textToEmbed.length} chars (heading context: ${hasHeadingContext ? 'yes' : 'no'})`);

        // Generate embedding for content with retry logic
        const embedding = await retryWithBackoff(async () => {
          const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'text-embedding-3-small',
              input: textToEmbed,
            }),
          });

          if (!response.ok) {
            throw new Error(`OpenAI error: ${response.status}`);
          }

          const data = await response.json();
          return data.data[0].embedding;
        }, 3, 500, 'OpenAI embedding');

        await supabase
          .from('pipeline_a_chunks_raw')
          .update({
            embedding: JSON.stringify(embedding),
            embedding_status: 'ready',
            embedded_at: new Date().toISOString(),
          })
          .eq('id', chunk.id);

        processed++;
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

      } catch (chunkError) {
        console.error(`[Pipeline A Embeddings] Failed chunk ${chunk.id}:`, chunkError);
        
        await supabase
          .from('pipeline_a_chunks_raw')
          .update({
            embedding_status: 'failed',
            embedding_error: chunkError instanceof Error ? chunkError.message : 'Unknown error',
          })
          .eq('id', chunk.id);

        failed++;
      }
    }

    // Update document status to 'ready' if all chunks complete
    const processedDocIds = [...new Set(chunks.map(c => c.document_id))];
    for (const docId of processedDocIds) {
      const { data: pendingChunks } = await supabase
        .from('pipeline_a_chunks_raw')
        .select('id')
        .eq('document_id', docId)
        .eq('embedding_status', 'pending')
        .limit(1);

      if (!pendingChunks || pendingChunks.length === 0) {
        await supabase
          .from('pipeline_a_documents')
          .update({ status: 'ready' })
          .eq('id', docId);
        console.log(`[Pipeline A Embeddings] Document ${docId} marked as ready`);
      }
    }

    console.log(`[Pipeline A Embeddings] Complete: ${processed} processed, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        failed,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline A Embeddings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
