import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { describeVisualElementContextAware } from "../_shared/visionEnhancer.ts";
import { generateEmbedding } from "../_shared/embeddingService.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Process 5 images at a time to avoid timeouts
const BATCH_SIZE = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY required for vision processing');
    }
    if (!openAiKey) {
      throw new Error('OPENAI_API_KEY required for embedding generation');
    }

    console.log('[Process Vision Queue] Starting batch processing');

    // Fetch pending queue items
    const { data: queueItems, error: fetchError } = await supabase
      .from('visual_enrichment_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) throw new Error(`Failed to fetch queue: ${fetchError.message}`);
    if (!queueItems || queueItems.length === 0) {
      console.log('[Process Vision Queue] No pending items');
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No items to process' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Process Vision Queue] Processing ${queueItems.length} item(s)`);

    let processedCount = 0;
    let failedCount = 0;

    for (const item of queueItems) {
      try {
        console.log(`[Vision Queue] Processing queue item ${item.id}`);

        // Update status to processing
        await supabase
          .from('visual_enrichment_queue')
          .update({ status: 'processing' })
          .eq('id', item.id);

        // Decode base64 image
        const imageBuffer = decodeBase64(item.image_base64);
        console.log(`[Vision Queue] Decoded image: ${imageBuffer.length} bytes`);

        // Extract metadata
        const metadata = item.image_metadata || {};
        const imageType = metadata.type || 'layout_picture';
        const documentContext = metadata.document_context || { domain: 'general' };

        // Call Claude Vision with context-awareness
        console.log(`[Vision Queue] Calling Claude Vision for ${metadata.image_name}`);
        const description = await describeVisualElementContextAware(
          imageBuffer,
          imageType,
          documentContext,
          anthropicKey
        );

        if (!description || description.length === 0) {
          throw new Error('Claude Vision returned empty description');
        }

        console.log(`[Vision Queue] ✓ Generated description: ${description.length} chars`);

        // Save enrichment result
        await supabase
          .from('visual_enrichment_queue')
          .update({
            enrichment_text: description,
            status: 'completed',
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        // ===== SELF-HEALING: Update chunks with placeholder =====
        const placeholder = `[VISUAL_ENRICHMENT_PENDING: ${item.id}]`;
        
        // Find chunks containing the placeholder
        const { data: chunksToUpdate, error: chunkFetchError } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id, content, original_content')
          .eq('document_id', item.document_id)
          .ilike('content', `%${placeholder}%`);

        if (chunkFetchError) {
          console.warn(`[Vision Queue] Failed to fetch chunks for placeholder replacement:`, chunkFetchError);
        } else if (chunksToUpdate && chunksToUpdate.length > 0) {
          console.log(`[Vision Queue] Found ${chunksToUpdate.length} chunk(s) with placeholder`);

          for (const chunk of chunksToUpdate) {
            // Replace placeholder with actual description
            const updatedContent = chunk.content.replace(
              new RegExp(`\\[VISUAL_ENRICHMENT_PENDING: ${item.id}\\]\\n\\(Image: [^)]+\\)\\n`, 'g'),
              `\n\n${description}\n\n`
            );
            
            const updatedOriginalContent = chunk.original_content
              ? chunk.original_content.replace(
                  new RegExp(`\\[VISUAL_ENRICHMENT_PENDING: ${item.id}\\]\\n\\(Image: [^)]+\\)\\n`, 'g'),
                  `\n\n${description}\n\n`
                )
              : null;

            // Update chunk content
            await supabase
              .from('pipeline_a_hybrid_chunks_raw')
              .update({ 
                content: updatedContent,
                original_content: updatedOriginalContent,
                embedding_status: 'pending' // Mark for re-embedding
              })
              .eq('id', chunk.id);

            console.log(`[Vision Queue] ✓ Updated chunk ${chunk.id}, marked for re-embedding`);
          }

          // Regenerate embeddings for updated chunks
          console.log(`[Vision Queue] Regenerating embeddings for ${chunksToUpdate.length} chunk(s)`);
          for (const chunk of chunksToUpdate) {
            try {
              const { data: updatedChunk } = await supabase
                .from('pipeline_a_hybrid_chunks_raw')
                .select('content, document_id')
                .eq('id', chunk.id)
                .single();

              if (updatedChunk) {
                // Get document name for embedding context
                const { data: doc } = await supabase
                  .from('pipeline_a_hybrid_documents')
                  .select('file_name')
                  .eq('id', updatedChunk.document_id)
                  .single();

                const embeddingInput = doc 
                  ? `Document: ${doc.file_name}\n\n${updatedChunk.content}`
                  : updatedChunk.content;

                const embedding = await generateEmbedding(embeddingInput, openAiKey);

                await supabase
                  .from('pipeline_a_hybrid_chunks_raw')
                  .update({ 
                    embedding: `[${embedding.embedding.join(',')}]`,
                    embedding_status: 'ready',
                    embedded_at: new Date().toISOString()
                  })
                  .eq('id', chunk.id);

                console.log(`[Vision Queue] ✓ Regenerated embedding for chunk ${chunk.id}`);
              }
            } catch (embErr: any) {
              console.error(`[Vision Queue] Failed to regenerate embedding for chunk ${chunk.id}:`, embErr);
            }
          }
        } else {
          console.log(`[Vision Queue] No chunks found with placeholder ${placeholder}`);
        }

        processedCount++;
        console.log(`[Vision Queue] ✅ Completed item ${item.id}`);

      } catch (itemError: any) {
        const errorMessage = itemError instanceof Error ? itemError.message : 'Unknown error';
        console.error(`[Vision Queue] ✗ Failed item ${item.id}:`, errorMessage);
        
        await supabase
          .from('visual_enrichment_queue')
          .update({
            status: 'failed',
            error_message: errorMessage,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        failedCount++;
      }
    }

    console.log(`[Process Vision Queue] Batch complete: ${processedCount} processed, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        failed: failedCount,
        message: `Processed ${processedCount} item(s), ${failedCount} failed`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Process Vision Queue] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
