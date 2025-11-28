import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbedding } from "../_shared/embeddingService.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Generate semantic summary for table chunks using Gemini Flash
 */
async function generateTableSummary(tableMarkdown: string, lovableApiKey: string): Promise<string> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'Sei un assistente specializzato nel creare sommari densi e ricchi di dati per tabelle. Il tuo compito è estrarre TUTTI i valori chiave (numeri, nomi, date, totali) dalla tabella Markdown e creare un breve testo descrittivo che catturi il contenuto essenziale.'
          },
          {
            role: 'user',
            content: `Crea un sommario breve (max 3 righe) di questa tabella, includendo TUTTI i valori numerici importanti, nomi, e totali:\n\n${tableMarkdown}\n\nSommario:`
          }
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      throw new Error('Empty summary from Gemini');
    }

    return summary;

  } catch (error) {
    console.error('[Table Summary] Generation failed:', error);
    throw error;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Regenerate Table Embeddings] Starting regeneration');

    // Find all table chunks with placeholder content
    const { data: tableChunks, error: fetchError } = await supabase
      .from('pipeline_a_hybrid_chunks_raw')
      .select(`
        *,
        pipeline_a_hybrid_documents!inner(file_name)
      `)
      .eq('chunk_type', 'table')
      .or('content.ilike.%Tabella con dati strutturati%,content.ilike.%Table with structured data%')
      .not('original_content', 'is', null);

    if (fetchError) {
      throw new Error(`Failed to fetch table chunks: ${fetchError.message}`);
    }

    if (!tableChunks || tableChunks.length === 0) {
      console.log('[Regenerate Table Embeddings] No table chunks with placeholder found');
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No table chunks to regenerate' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Regenerate Table Embeddings] Found ${tableChunks.length} table chunks to regenerate`);

    let processedCount = 0;
    let failedCount = 0;

    for (const chunk of tableChunks) {
      try {
        console.log(`[Regenerate] Processing chunk ${chunk.id} (${chunk.pipeline_a_hybrid_documents?.file_name})`);

        // Generate semantic summary from original_content
        const summary = await generateTableSummary(chunk.original_content, lovableApiKey);
        console.log(`[Regenerate] Generated summary: ${summary.slice(0, 100)}...`);

        // Build embedding input with document context
        const fileName = chunk.pipeline_a_hybrid_documents?.file_name || 'Unknown';
        let embeddingInput = `Document: ${fileName}\n\n`;
        
        if (chunk.heading_hierarchy && Array.isArray(chunk.heading_hierarchy) && chunk.heading_hierarchy.length > 0) {
          const headings = chunk.heading_hierarchy.map((h: any) => h.text || '').filter(Boolean);
          if (headings.length > 0) {
            embeddingInput += headings.join(' > ') + '\n\n';
          }
        }
        
        embeddingInput += summary;

        // Generate new embedding
        const result = await generateEmbedding(embeddingInput, openaiKey);

        // Update chunk with new summary and embedding
        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .update({
            content: summary,
            embedding: JSON.stringify(result.embedding),
            embedding_status: 'ready',
            embedded_at: new Date().toISOString()
          })
          .eq('id', chunk.id);

        console.log(`[Regenerate] ✅ Chunk ${chunk.id} updated successfully`);
        processedCount++;

      } catch (chunkError) {
        console.error(`[Regenerate] ❌ Failed to process chunk ${chunk.id}:`, chunkError);
        failedCount++;
      }
    }

    console.log(`[Regenerate Table Embeddings] Complete: ${processedCount} processed, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        failed: failedCount,
        total: tableChunks.length,
        message: `Regenerated embeddings for ${processedCount}/${tableChunks.length} table chunks`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Regenerate Table Embeddings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
