import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbedding } from "../_shared/embeddingService.ts";

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
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!openAiKey) {
      throw new Error('OPENAI_API_KEY required for embedding generation');
    }

    console.log('[Recover Pending Visuals] Starting recovery process');

    // Find all chunks with VISUAL_ENRICHMENT_PENDING placeholders
    const { data: chunksWithPlaceholders, error: fetchError } = await supabase
      .from('pipeline_a_hybrid_chunks_raw')
      .select('id, content, original_content, document_id')
      .ilike('content', '%[VISUAL_ENRICHMENT_PENDING:%');

    if (fetchError) throw new Error(`Failed to fetch chunks: ${fetchError.message}`);
    if (!chunksWithPlaceholders || chunksWithPlaceholders.length === 0) {
      console.log('[Recover Pending Visuals] No chunks with placeholders found');
      return new Response(
        JSON.stringify({ success: true, recovered: 0, message: 'No chunks to recover' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Recover Pending Visuals] Found ${chunksWithPlaceholders.length} chunk(s) with placeholders`);

    let recoveredCount = 0;
    let failedCount = 0;

    for (const chunk of chunksWithPlaceholders) {
      try {
        // Extract all queue IDs from placeholders in this chunk
        const placeholderMatches = chunk.content.matchAll(/\[VISUAL_ENRICHMENT_PENDING: ([a-f0-9-]+)\]/g);
        const queueIds = (Array.from(placeholderMatches) as RegExpMatchArray[]).map(match => match[1]);

        if (queueIds.length === 0) {
          console.warn(`[Recover] No valid UUIDs found in chunk ${chunk.id}`);
          continue;
        }

        console.log(`[Recover] Chunk ${chunk.id} has ${queueIds.length} placeholder(s): ${queueIds.join(', ')}`);

        let updatedContent = chunk.content;
        let updatedOriginalContent = chunk.original_content;

        // Replace each placeholder with its enrichment text
        for (const queueId of queueIds) {
          // Fetch enrichment text from queue
          const { data: queueItem, error: queueError } = await supabase
            .from('visual_enrichment_queue')
            .select('enrichment_text, status')
            .eq('id', queueId)
            .single();

          if (queueError || !queueItem) {
            console.warn(`[Recover] Queue item ${queueId} not found, skipping`);
            continue;
          }

          if (queueItem.status !== 'completed' || !queueItem.enrichment_text) {
            console.warn(`[Recover] Queue item ${queueId} not completed or missing enrichment_text, skipping`);
            continue;
          }

          const description = queueItem.enrichment_text;
          console.log(`[Recover] Replacing placeholder ${queueId} with description (${description.length} chars)`);

          // Replace placeholder with flexible regex (newline optional)
          const placeholderRegex = new RegExp(
            `\\[VISUAL_ENRICHMENT_PENDING: ${queueId}\\]\\n\\(Image: [^)]+\\)\\n?`,
            'g'
          );

          updatedContent = updatedContent.replace(placeholderRegex, `\n\n${description}\n\n`);
          
          if (updatedOriginalContent) {
            updatedOriginalContent = updatedOriginalContent.replace(placeholderRegex, `\n\n${description}\n\n`);
          }
        }

        // Update chunk content
        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .update({ 
            content: updatedContent,
            original_content: updatedOriginalContent,
            embedding_status: 'pending'
          })
          .eq('id', chunk.id);

        console.log(`[Recover] ✓ Updated chunk ${chunk.id}, marked for re-embedding`);

        // Regenerate embedding
        const { data: doc } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('file_name')
          .eq('id', chunk.document_id)
          .single();

        const embeddingInput = doc 
          ? `Document: ${doc.file_name}\n\n${updatedContent}`
          : updatedContent;

        const embedding = await generateEmbedding(embeddingInput, openAiKey);

        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .update({ 
            embedding: `[${embedding.embedding.join(',')}]`,
            embedding_status: 'ready',
            embedded_at: new Date().toISOString()
          })
          .eq('id', chunk.id);

        console.log(`[Recover] ✓ Regenerated embedding for chunk ${chunk.id}`);
        recoveredCount++;

      } catch (chunkError: any) {
        const errorMessage = chunkError instanceof Error ? chunkError.message : 'Unknown error';
        console.error(`[Recover] ✗ Failed to recover chunk ${chunk.id}:`, errorMessage);
        failedCount++;
      }
    }

    console.log(`[Recover Pending Visuals] Recovery complete: ${recoveredCount} recovered, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        recovered: recoveredCount,
        failed: failedCount,
        message: `Recovered ${recoveredCount} chunk(s), ${failedCount} failed`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Recover Pending Visuals] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
