import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbedding } from "../_shared/embeddingService.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 10;

function buildEmbeddingInput(chunk: any): string {
  let embeddingText = '';
  
  if (chunk.heading_hierarchy && Array.isArray(chunk.heading_hierarchy) && chunk.heading_hierarchy.length > 0) {
    const headings = chunk.heading_hierarchy.map((h: any) => h.text || '').filter(Boolean);
    if (headings.length > 0) {
      embeddingText = headings.join(' > ') + '\n\n';
    }
  }
  
  embeddingText += chunk.content;
  return embeddingText;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Pipeline A-Hybrid Embeddings] Starting embedding generation');

    // Status reconciliation
    const { data: stuckDocs } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id')
      .neq('status', 'ready')
      .neq('status', 'failed');

    if (stuckDocs && stuckDocs.length > 0) {
      for (const doc of stuckDocs) {
        const { count } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', doc.id)
          .neq('embedding_status', 'ready');

        if (count === 0) {
          await supabase
            .from('pipeline_a_hybrid_documents')
            .update({ status: 'ready', updated_at: new Date().toISOString() })
            .eq('id', doc.id);
          console.log(`[Pipeline A-Hybrid Embeddings] Reconciled document ${doc.id} to ready`);
        }
      }
    }

    // Fetch pending chunks
    let query = supabase
      .from('pipeline_a_hybrid_chunks_raw')
      .select('*')
      .eq('embedding_status', 'pending')
      .order('created_at', { ascending: true });

    if (documentId) {
      query = query.eq('document_id', documentId);
    } else {
      query = query.limit(BATCH_SIZE);
    }

    const { data: chunks, error: fetchError } = await query;

    if (fetchError) throw new Error(`Failed to fetch chunks: ${fetchError.message}`);
    if (!chunks || chunks.length === 0) {
      console.log('[Pipeline A-Hybrid Embeddings] No pending chunks');
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No chunks to process' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline A-Hybrid Embeddings] Processing ${chunks.length} chunk(s)`);

    let processedCount = 0;
    let failedCount = 0;

    for (const chunk of chunks) {
      try {
        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .update({ embedding_status: 'processing' })
          .eq('id', chunk.id);

        const embeddingInput = buildEmbeddingInput(chunk);
        const result = await generateEmbedding(embeddingInput, openaiKey);

        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .update({
            embedding: JSON.stringify(result.embedding),
            embedding_status: 'ready',
            embedded_at: new Date().toISOString()
          })
          .eq('id', chunk.id);

        processedCount++;
      } catch (chunkError) {
        console.error(`[Pipeline A-Hybrid Embeddings] Failed to process chunk ${chunk.id}:`, chunkError);
        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .update({
            embedding_status: 'failed',
            embedding_error: chunkError instanceof Error ? chunkError.message : 'Unknown error'
          })
          .eq('id', chunk.id);
        failedCount++;
      }
    }

    // Update document status to ready
    const documentIds = [...new Set(chunks.map(c => c.document_id))];
    for (const docId of documentIds) {
      const { count } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', docId)
        .neq('embedding_status', 'ready');

      if (count === 0) {
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({ status: 'ready', updated_at: new Date().toISOString() })
          .eq('id', docId);
        console.log(`[Pipeline A-Hybrid Embeddings] Document ${docId} marked ready`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        failed: failedCount,
        message: `Processed ${processedCount} chunk(s), ${failedCount} failed`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline A-Hybrid Embeddings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
