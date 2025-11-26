import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 20;
const RATE_LIMIT_DELAY = 100;

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

    // Status reconciliation: fix stuck documents
    const { data: stuckDocs } = await supabase
      .from('pipeline_a_documents')
      .select('id')
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
          await supabase
            .from('pipeline_a_documents')
            .update({ status: 'ingested' })
            .eq('id', doc.id);
          console.log(`[Pipeline A Embeddings] Reset document ${doc.id} to 'ingested' (no chunks)`);
        } else {
          const allReady = chunks.every(c => c.embedding_status === 'ready');
          if (allReady) {
            await supabase
              .from('pipeline_a_documents')
              .update({ status: 'ready' })
              .eq('id', doc.id);
            console.log(`[Pipeline A Embeddings] Reconciled document ${doc.id} to 'ready'`);
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

        // Generate embedding for content (summary for tables, text for regular chunks)
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: chunk.content,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        const embedding = data.data[0].embedding;

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
