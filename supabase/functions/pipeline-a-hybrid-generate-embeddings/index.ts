import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbedding } from "../_shared/embeddingService.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 10;

/**
 * Generate semantic summary for table chunks using Gemini Flash
 * This creates dense, data-rich summaries from Markdown tables for embedding generation
 */
async function generateTableSummary(tableMarkdown: string): Promise<string> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  
  if (!lovableApiKey) {
    console.warn('[Table Summary] LOVABLE_API_KEY not found, using placeholder');
    return tableMarkdown; // Fallback to original content
  }

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
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      throw new Error('Empty summary from Gemini');
    }

    console.log(`[Table Summary] Generated: ${summary.slice(0, 100)}...`);
    return summary;

  } catch (error) {
    console.error('[Table Summary] Generation failed:', error);
    return tableMarkdown; // Fallback to original content
  }
}

/**
 * Build embedding input text with semantic context
 * For tables: generates descriptive summary instead of using placeholder
 */
async function buildEmbeddingInput(chunk: any, fileName: string): Promise<string> {
  let embeddingText = `Document: ${fileName}\n\n`;
  
  if (chunk.heading_hierarchy && Array.isArray(chunk.heading_hierarchy) && chunk.heading_hierarchy.length > 0) {
    const headings = chunk.heading_hierarchy.map((h: any) => h.text || '').filter(Boolean);
    if (headings.length > 0) {
      embeddingText += headings.join(' > ') + '\n\n';
    }
  }
  
  // TABLE SEMANTIC SUMMARY GENERATION
  // If chunk is a table with placeholder content, generate semantic summary from original_content
  if (chunk.chunk_type === 'table' && chunk.original_content) {
    const isPlaceholder = chunk.content.includes('Tabella con dati strutturati') || 
                          chunk.content.includes('Table with structured data');
    
    if (isPlaceholder) {
      console.log(`[Embedding Input] Generating semantic summary for table chunk ${chunk.id}`);
      const tableSummary = await generateTableSummary(chunk.original_content);
      embeddingText += tableSummary;
      
      // Update chunk.content with summary for storage (will be saved later)
      chunk.semantic_summary = tableSummary;
    } else {
      embeddingText += chunk.content;
    }
  } else {
    embeddingText += chunk.content;
  }
  
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
        // Verifica che esistano chunks E siano TUTTI ready
        const { count: totalChunks } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', doc.id);

        const { count: readyChunks } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', doc.id)
          .eq('embedding_status', 'ready');

        // Solo se ha chunks E sono tutti ready
        if (totalChunks && totalChunks > 0 && readyChunks === totalChunks) {
          await supabase
            .from('pipeline_a_hybrid_documents')
            .update({ status: 'ready', updated_at: new Date().toISOString() })
            .eq('id', doc.id);
          console.log(`[Pipeline A-Hybrid Embeddings] Reconciled document ${doc.id} to ready (${readyChunks}/${totalChunks} chunks ready)`);
        }
      }
    }

    // Fetch pending chunks with document file_name via JOIN
    let query = supabase
      .from('pipeline_a_hybrid_chunks_raw')
      .select(`
        *,
        pipeline_a_hybrid_documents!inner(file_name)
      `)
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

        const fileName = chunk.pipeline_a_hybrid_documents?.file_name || 'Unknown';
        const embeddingInput = await buildEmbeddingInput(chunk, fileName);
        const result = await generateEmbedding(embeddingInput, openaiKey);

        // Prepare update object
        const updateData: any = {
          embedding: JSON.stringify(result.embedding),
          embedding_status: 'ready',
          embedded_at: new Date().toISOString()
        };

        // If semantic summary was generated, update content field
        if (chunk.semantic_summary) {
          updateData.content = chunk.semantic_summary;
          console.log(`[Pipeline A-Hybrid Embeddings] Updated content with semantic summary for chunk ${chunk.id}`);
        }

        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .update(updateData)
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
      // Verifica che esistano chunks E siano TUTTI ready
      const { count: totalChunks } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', docId);

      const { count: readyChunks } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', docId)
        .eq('embedding_status', 'ready');

      // Solo se ha chunks E sono tutti ready
      if (totalChunks && totalChunks > 0 && readyChunks === totalChunks) {
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({ status: 'ready', updated_at: new Date().toISOString() })
          .eq('id', docId);
        console.log(`[Pipeline A-Hybrid Embeddings] Document ${docId} marked ready (${readyChunks}/${totalChunks} chunks ready)`);
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
