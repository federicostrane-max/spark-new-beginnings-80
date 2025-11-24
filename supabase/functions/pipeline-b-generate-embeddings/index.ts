import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 50; // Process 50 chunks at a time
const EMBEDDING_MODEL = 'text-embedding-3-small';

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  return result.data[0].embedding;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🧮 Pipeline B Generate Embeddings - Starting...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch chunks with pending embeddings
    const { data: chunks, error: fetchError } = await supabase
      .from('pipeline_b_chunks_raw')
      .select('id, content, document_id')
      .eq('embedding_status', 'pending')
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;

    if (!chunks || chunks.length === 0) {
      console.log('✓ No chunks pending embedding');
      return new Response(
        JSON.stringify({ message: 'No chunks pending embedding' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Generating embeddings for ${chunks.length} chunks`);

    const results = {
      processed: 0,
      failed: 0,
      errors: [] as Array<{ id: string; error: string }>,
    };

    // Process each chunk
    for (const chunk of chunks) {
      try {
        // Mark as processing
        await supabase
          .from('pipeline_b_chunks_raw')
          .update({ embedding_status: 'processing' })
          .eq('id', chunk.id);

        // Generate embedding
        const embedding = await generateEmbedding(chunk.content, openaiKey);

        // Validate embedding
        if (!Array.isArray(embedding) || embedding.length !== 1536) {
          throw new Error(`Invalid embedding dimensions: ${embedding?.length}`);
        }

        // Update chunk with embedding
        const { error: updateError } = await supabase
          .from('pipeline_b_chunks_raw')
          .update({
            embedding: JSON.stringify(embedding),
            embedding_status: 'ready',
            embedded_at: new Date().toISOString(),
          })
          .eq('id', chunk.id);

        if (updateError) throw updateError;

        results.processed++;
        console.log(`✓ Embedded chunk ${chunk.id}`);

        // Rate limiting: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Failed to embed chunk ${chunk.id}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Mark as failed
        await supabase
          .from('pipeline_b_chunks_raw')
          .update({
            embedding_status: 'failed',
            embedding_error: errorMessage,
          })
          .eq('id', chunk.id);

        results.failed++;
        results.errors.push({ id: chunk.id, error: errorMessage });
      }
    }

    // Update document status when all chunks are ready
    const documentIds = [...new Set(chunks.map(c => c.document_id))];
    console.log(`\n🔍 Checking status for ${documentIds.length} documents...`);

    for (const docId of documentIds) {
      const { data: pendingChunks } = await supabase
        .from('pipeline_b_chunks_raw')
        .select('id')
        .eq('document_id', docId)
        .neq('embedding_status', 'ready')
        .limit(1);

      // If no pending chunks remain, mark document as ready
      if (!pendingChunks || pendingChunks.length === 0) {
        const { error: updateError } = await supabase
          .from('pipeline_b_documents')
          .update({ status: 'ready' })
          .eq('id', docId);

        if (updateError) {
          console.error(`❌ Failed to update document ${docId}:`, updateError);
        } else {
          console.log(`✅ Document ${docId} marked as ready`);
        }
      } else {
        console.log(`⏳ Document ${docId} still has pending chunks`);
      }
    }

    console.log(`\n✅ Embedding generation complete:`);
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Failed: ${results.failed}`);

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Pipeline B Generate Embeddings error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});