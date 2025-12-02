import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { describeVisualElementContextAware } from '../_shared/visionEnhancer.ts';
import { generateEmbedding } from '../_shared/embeddingService.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { queueItemId } = await req.json();

    if (!queueItemId) {
      throw new Error('queueItemId is required');
    }

    console.log(`[process-vision-job] Processing queue item: ${queueItemId}`);

    // Fetch single queue item
    const { data: queueItem, error: fetchError } = await supabaseClient
      .from('visual_enrichment_queue')
      .select('*')
      .eq('id', queueItemId)
      .eq('status', 'pending')
      .single();

    if (fetchError || !queueItem) {
      console.log(`[process-vision-job] Queue item not found or already processed: ${queueItemId}`);
      return new Response(
        JSON.stringify({ message: 'Queue item not found or already processed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Mark as processing
    await supabaseClient
      .from('visual_enrichment_queue')
      .update({ status: 'processing' })
      .eq('id', queueItem.id);

    try {
      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!anthropicKey) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }

      // Decode base64 image
      const imageBuffer = Uint8Array.from(atob(queueItem.image_base64), c => c.charCodeAt(0));

      // Extract page number from metadata for RAG
      const metadata = queueItem.image_metadata || {};
      const pageNumber = metadata.page;

      // Call Vision API with context-aware prompt
      const enrichmentText = await describeVisualElementContextAware(
        imageBuffer,
        queueItem.element_type || metadata.type || 'layout_picture',
        queueItem.document_context || metadata.document_context || {},
        anthropicKey,
        pageNumber  // Pass page number for RAG metadata
      );

      // Update queue item with result
      await supabaseClient
        .from('visual_enrichment_queue')
        .update({
          enrichment_text: enrichmentText,
          status: 'completed',
          processed_at: new Date().toISOString()
        })
        .eq('id', queueItem.id);

      console.log(`[process-vision-job] ✅ Enrichment complete for ${queueItem.element_type}`);

      // Self-healing: Find and update chunks with placeholder
      const placeholderPattern = `[VISUAL_ENRICHMENT_PENDING: ${queueItem.id}]`;
      
      const { data: affectedChunks, error: searchError } = await supabaseClient
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id, content, document_id')
        .eq('document_id', queueItem.document_id)
        .ilike('content', `%${placeholderPattern}%`);

      if (searchError) {
        console.error(`[process-vision-job] ❌ Error searching chunks:`, searchError);
      } else if (affectedChunks && affectedChunks.length > 0) {
        console.log(`[process-vision-job] Found ${affectedChunks.length} chunks with placeholder`);

        for (const chunk of affectedChunks) {
          const updatedContent = chunk.content.replace(placeholderPattern, enrichmentText);

          // Update chunk content
          const { error: updateError } = await supabaseClient
            .from('pipeline_a_hybrid_chunks_raw')
            .update({ content: updatedContent })
            .eq('id', chunk.id);

          if (updateError) {
            console.error(`[process-vision-job] ❌ Failed to update chunk ${chunk.id}:`, updateError);
            continue;
          }

          // Regenerate embedding
          const openaiKey = Deno.env.get('OPENAI_API_KEY');
          if (!openaiKey) {
            console.error('[process-vision-job] ❌ Missing OPENAI_API_KEY');
            continue;
          }

          try {
            // Fetch document filename for embedding context
            const { data: doc } = await supabaseClient
              .from('pipeline_a_hybrid_documents')
              .select('file_name')
              .eq('id', chunk.document_id)
              .single();

            const embeddingInput = doc?.file_name 
              ? `Document: ${doc.file_name}\n\n${updatedContent}`
              : updatedContent;

            const embeddingResult = await generateEmbedding(embeddingInput, openaiKey);

            await supabaseClient
              .from('pipeline_a_hybrid_chunks_raw')
              .update({
                embedding: JSON.stringify(embeddingResult.embedding),
                embedding_status: 'ready',
                embedded_at: new Date().toISOString()
              })
              .eq('id', chunk.id);

            console.log(`[process-vision-job] ✅ Regenerated embedding for chunk ${chunk.id}`);
          } catch (embError) {
            console.error(`[process-vision-job] ❌ Embedding generation failed for chunk ${chunk.id}:`, embError);
          }
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          queueItemId: queueItem.id,
          chunksUpdated: affectedChunks?.length || 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );

    } catch (processingError) {
      console.error(`[process-vision-job] ❌ Processing failed:`, processingError);

      const errorMessage = processingError instanceof Error ? processingError.message : String(processingError);

      // Mark as failed
      await supabaseClient
        .from('visual_enrichment_queue')
        .update({
          status: 'failed',
          error_message: errorMessage
        })
        .eq('id', queueItem.id);

      throw processingError;
    }

  } catch (error) {
    console.error('[process-vision-job] ❌ Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
