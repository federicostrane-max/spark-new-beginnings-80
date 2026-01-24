import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { describeVisualElementContextAware } from "../_shared/visionEnhancer.ts";
import { generateEmbedding } from "../_shared/embeddingService.ts";

// Declare EdgeRuntime for background task support
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Process 25 images at a time - accelerated for large queues
const BATCH_SIZE = 25;
// Maximum iterations to prevent infinite loops
const MAX_ITERATIONS = 20;

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

    console.log('[Process Vision Queue] Starting continuous queue processing');

    // ===== PHASE 0: STUCK JOB RECOVERY =====
    // Reset jobs stuck in 'processing' for more than 5 minutes (worker crash/timeout)
    const STUCK_JOB_THRESHOLD_MINUTES = 5;
    const stuckThreshold = new Date(Date.now() - STUCK_JOB_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    
    const { data: stuckJobs, error: stuckError } = await supabase
      .from('visual_enrichment_queue')
      .select('id, chunk_id, document_id, created_at')
      .eq('status', 'processing')
      .lt('created_at', stuckThreshold);
    
    if (stuckError) {
      console.error('[Process Vision Queue] Failed to fetch stuck jobs:', stuckError.message);
    } else if (stuckJobs && stuckJobs.length > 0) {
      console.log(`[Process Vision Queue] 🔧 Found ${stuckJobs.length} stuck job(s) in 'processing' state, resetting to 'pending'`);
      
      for (const stuckJob of stuckJobs) {
        const { error: resetError } = await supabase
          .from('visual_enrichment_queue')
          .update({ status: 'pending' })
          .eq('id', stuckJob.id);
        
        if (resetError) {
          console.error(`[Process Vision Queue] Failed to reset stuck job ${stuckJob.id}:`, resetError.message);
        } else {
          console.log(`[Process Vision Queue] ✓ Reset stuck job ${stuckJob.id} (created ${stuckJob.created_at})`);
        }
      }
    }

    let totalProcessed = 0;
    let totalFailed = 0;
    let iteration = 0;

    // Continuous loop: process until queue is empty or max iterations reached
    while (iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(`[Process Vision Queue] Iteration ${iteration}/${MAX_ITERATIONS}`);

      // Fetch pending queue items - ONLY those with valid chunk_id to avoid constraint errors
      const { data: queueItems, error: fetchError } = await supabase
        .from('visual_enrichment_queue')
        .select('*')
        .eq('status', 'pending')
        .not('chunk_id', 'is', null)  // CRITICAL: Skip unlinked jobs to prevent infinite loop
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (fetchError) throw new Error(`Failed to fetch queue: ${fetchError.message}`);
      
      // Exit loop if no more pending items
      if (!queueItems || queueItems.length === 0) {
        console.log('[Process Vision Queue] Queue drained - no more pending items');
        break;
      }

      console.log(`[Process Vision Queue] Processing batch of ${queueItems.length} item(s)`);

      let processedCount = 0;
      let failedCount = 0;

    for (const item of queueItems) {
      try {
        console.log(`[Vision Queue] Processing queue item ${item.id}`);

        // Update status to processing
        const { error: processingUpdateError } = await supabase
          .from('visual_enrichment_queue')
          .update({ status: 'processing' })
          .eq('id', item.id);

        if (processingUpdateError) {
          throw new Error(`Failed to update queue status to processing: ${processingUpdateError.message}`);
        }

        // Decode base64 image
        const imageBuffer = decodeBase64(item.image_base64);
        console.log(`[Vision Queue] Decoded image: ${imageBuffer.length} bytes`);

        // Extract metadata
        const metadata = item.image_metadata || {};
        const imageType = metadata.type || 'layout_picture';
        const pageNumber = metadata.page;  // Extract page number for RAG metadata
        
        // 🔧 FIX: Infer domain from document folder if document_context missing
        let documentContext = metadata.document_context;
        if (!documentContext) {
          // Fetch document folder to infer domain
          const { data: docData } = await supabase
            .from('pipeline_a_hybrid_documents')
            .select('folder, file_name')
            .eq('id', item.document_id)
            .single();
          
          // Infer domain from folder name
          const folder = docData?.folder?.toLowerCase() || '';
          let inferredDomain = 'general';
          
          if (folder.includes('financebench') || folder.includes('finance') || folder.includes('finqa')) {
            inferredDomain = 'finance';
          } else if (folder.includes('trading')) {
            inferredDomain = 'trading';
          } else if (folder.includes('medical') || folder.includes('health')) {
            inferredDomain = 'medical';
          } else if (folder.includes('architecture') || folder.includes('floorplan')) {
            inferredDomain = 'architecture';
          }
          
          documentContext = { domain: inferredDomain };
          console.log(`[Vision Queue] Inferred domain '${inferredDomain}' from folder '${folder}' for ${docData?.file_name}`);
        }

        // Call Claude Vision with context-awareness
        console.log(`[Vision Queue] Calling Claude Vision for ${metadata.image_name}, page: ${pageNumber || 'unknown'}`);
        const description = await describeVisualElementContextAware(
          imageBuffer,
          imageType,
          documentContext,
          anthropicKey,
          pageNumber  // Pass page number for RAG metadata
        );

        if (!description || description.length === 0) {
          throw new Error('Claude Vision returned empty description');
        }

        console.log(`[Vision Queue] ✓ Generated description: ${description.length} chars`);

        // Save enrichment result
        const { error: completedUpdateError } = await supabase
          .from('visual_enrichment_queue')
          .update({
            enrichment_text: description,
            status: 'completed',
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        if (completedUpdateError) {
          throw new Error(`Failed to update queue status to completed: ${completedUpdateError.message}`);
        }

        // ===== UPDATE CHUNK WITH VISUAL DESCRIPTION =====
        // NEW ARCHITECTURE: Dedicated visual chunks are updated directly
        // BACKWARD COMPAT: Old chunks with placeholders use replacement logic
        
        if (item.chunk_id) {
          // ✅ NEW ARCHITECTURE: Update dedicated visual chunk directly
          console.log(`[Vision Queue] Updating dedicated visual chunk ${item.chunk_id}`);
          
          // Get document name for embedding context
          const { data: doc } = await supabase
            .from('pipeline_a_hybrid_documents')
            .select('file_name')
            .eq('id', item.document_id)
            .single();
          
          // Update chunk with description and mark ready for embedding
          const { error: updateChunkError } = await supabase
            .from('pipeline_a_hybrid_chunks_raw')
            .update({
              content: description,
              embedding_status: 'pending' // Ready for embedding generation
            })
            .eq('id', item.chunk_id);

          if (updateChunkError) {
            console.error(`[Vision Queue] Failed to update chunk ${item.chunk_id}:`, updateChunkError.message);
          } else {
            console.log(`[Vision Queue] ✓ Updated visual chunk ${item.chunk_id} with ${description.length} chars`);
            
            // Generate embedding immediately for the visual chunk
            try {
              const embeddingInput = doc 
                ? `Document: ${doc.file_name}\n\n${description}`
                : description;

              const embedding = await generateEmbedding(embeddingInput, openAiKey);

              await supabase
                .from('pipeline_a_hybrid_chunks_raw')
                .update({ 
                  embedding: `[${embedding.embedding.join(',')}]`,
                  embedding_status: 'ready',
                  embedded_at: new Date().toISOString()
                })
                .eq('id', item.chunk_id);

              console.log(`[Vision Queue] ✓ Generated embedding for visual chunk ${item.chunk_id}`);

              // === EVENT-DRIVEN: Check if all chunks are now ready for this document ===
              const { count: remainingNonReady } = await supabase
                .from('pipeline_a_hybrid_chunks_raw')
                .select('id', { count: 'exact', head: true })
                .eq('document_id', item.document_id)
                .neq('embedding_status', 'ready');

              if (remainingNonReady === 0) {
                console.log(`[Vision Queue] 🎯 All chunks ready for doc ${item.document_id}, finalizing immediately`);

                // Update document status to ready
                await supabase
                  .from('pipeline_a_hybrid_documents')
                  .update({ status: 'ready', updated_at: new Date().toISOString() })
                  .eq('id', item.document_id);

                // Trigger benchmark assignment if applicable
                EdgeRuntime.waitUntil((async () => {
                  const { data: benchmark } = await supabase
                    .from('benchmark_datasets')
                    .select('id')
                    .eq('document_id', item.document_id)
                    .limit(1);

                  if (benchmark && benchmark.length > 0) {
                    await fetch(`${supabaseUrl}/functions/v1/assign-benchmark-chunks`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${supabaseKey}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ documentId: item.document_id }),
                    });
                    console.log(`[Vision Queue] 🎯 Triggered benchmark assignment for doc ${item.document_id}`);
                  }
                })());
              }
            } catch (embErr: any) {
              console.error(`[Vision Queue] Failed to generate embedding for chunk ${item.chunk_id}:`, embErr);
              // Mark as pending so cron can retry
            }
          }
        } else {
          // ⚠️ BACKWARD COMPATIBILITY: Old architecture with placeholders in text chunks
          console.log(`[Vision Queue] Legacy mode: searching for placeholder in text chunks`);
          
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
                new RegExp(`\\[VISUAL_ENRICHMENT_PENDING: ${item.id}\\]\\n\\(Image: [^)]+\\)\\n?`, 'g'),
                `\n\n${description}\n\n`
              );
              
              const updatedOriginalContent = chunk.original_content
                ? chunk.original_content.replace(
                    new RegExp(`\\[VISUAL_ENRICHMENT_PENDING: ${item.id}\\]\\n\\(Image: [^)]+\\)\\n?`, 'g'),
                    `\n\n${description}\n\n`
                  )
                : null;

              // Update chunk content
              await supabase
                .from('pipeline_a_hybrid_chunks_raw')
                .update({ 
                  content: updatedContent,
                  original_content: updatedOriginalContent,
                  embedding_status: 'pending'
                })
                .eq('id', chunk.id);

              console.log(`[Vision Queue] ✓ Updated chunk ${chunk.id}, marked for re-embedding`);
            }

            // Regenerate embeddings for updated chunks
            for (const chunk of chunksToUpdate) {
              try {
                const { data: updatedChunk } = await supabase
                  .from('pipeline_a_hybrid_chunks_raw')
                  .select('content, document_id')
                  .eq('id', chunk.id)
                  .single();

                if (updatedChunk) {
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

            // === EVENT-DRIVEN: Check if all chunks are now ready for this document ===
            const { count: remainingNonReady } = await supabase
              .from('pipeline_a_hybrid_chunks_raw')
              .select('id', { count: 'exact', head: true })
              .eq('document_id', item.document_id)
              .neq('embedding_status', 'ready');

            if (remainingNonReady === 0) {
              console.log(`[Vision Queue] 🎯 All chunks ready for doc ${item.document_id} (legacy mode), finalizing immediately`);

              await supabase
                .from('pipeline_a_hybrid_documents')
                .update({ status: 'ready', updated_at: new Date().toISOString() })
                .eq('id', item.document_id);

              // Trigger benchmark assignment if applicable
              EdgeRuntime.waitUntil((async () => {
                const { data: benchmark } = await supabase
                  .from('benchmark_datasets')
                  .select('id')
                  .eq('document_id', item.document_id)
                  .limit(1);

                if (benchmark && benchmark.length > 0) {
                  await fetch(`${supabaseUrl}/functions/v1/assign-benchmark-chunks`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${supabaseKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ documentId: item.document_id }),
                  });
                }
              })());
            }
          } else {
            console.log(`[Vision Queue] No chunks found with placeholder ${placeholder}`);
          }
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

      totalProcessed += processedCount;
      totalFailed += failedCount;
      console.log(`[Process Vision Queue] Batch ${iteration} complete: ${processedCount} processed, ${failedCount} failed`);
      console.log(`[Process Vision Queue] Total progress: ${totalProcessed} processed, ${totalFailed} failed`);

      // Small delay between batches to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000));

      // ===== EVENT-DRIVEN: Trigger embedding generation for processed documents =====
      // Collect unique document IDs from this batch
      const processedDocIds = [...new Set(queueItems.filter(q => q.status !== 'failed').map(q => q.document_id))];

      if (processedDocIds.length > 0) {
        console.log(`[Process Vision Queue] 🎯 Triggering embeddings for ${processedDocIds.length} document(s)`);

        for (const docId of processedDocIds) {
          EdgeRuntime.waitUntil(
            fetch(`${supabaseUrl}/functions/v1/pipeline-a-hybrid-generate-embeddings`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ documentId: docId }),
            }).catch(err => console.error(`[Vision Queue] Failed to trigger embeddings for ${docId}:`, err))
          );
        }
      }
    }

    if (iteration >= MAX_ITERATIONS) {
      console.warn(`[Process Vision Queue] Reached maximum iterations (${MAX_ITERATIONS}). Stopping to prevent infinite loop.`);
    }

    console.log(`[Process Vision Queue] ✅ Final summary: ${totalProcessed} processed, ${totalFailed} failed across ${iteration} iteration(s)`);

    // ===== PHASE 3: ZOMBIE DOCUMENT FINALIZATION =====
    // Check for documents stuck in 'chunked' status where ALL chunks are 'ready'
    // This fixes the architectural dead-lock where generate-embeddings only updates docs when it processes chunks
    console.log(`[Vision Queue DEBUG] 🔍 Starting zombie document finalization check...`);
    
    const { data: zombieDocuments, error: zombieError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id, file_name, status')
      .eq('status', 'chunked');

    if (zombieError) {
      console.error('[Vision Queue DEBUG] Failed to fetch zombie documents:', zombieError.message);
    } else {
      console.log(`[Vision Queue DEBUG] Found ${zombieDocuments?.length || 0} document(s) in 'chunked' status`);
    }
    
    if (zombieDocuments && zombieDocuments.length > 0) {
      for (const doc of zombieDocuments) {
        // Count total chunks vs ready chunks
        const { count: totalChunks } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', doc.id);

        const { count: readyChunks } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', doc.id)
          .eq('embedding_status', 'ready');

        // 🔍 DEBUG: Check other statuses
        const { count: waitingEnrichment } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', doc.id)
          .eq('embedding_status', 'waiting_enrichment');

        const { count: pendingChunks } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', doc.id)
          .eq('embedding_status', 'pending');

        console.log(`[Vision Queue DEBUG] Zombie check ${doc.file_name}: total=${totalChunks}, ready=${readyChunks}, pending=${pendingChunks}, waiting_enrichment=${waitingEnrichment}`);

        // If ALL chunks are ready, finalize document
        if (totalChunks && totalChunks > 0 && readyChunks === totalChunks) {
          const { error: updateError } = await supabase
            .from('pipeline_a_hybrid_documents')
            .update({ status: 'ready', updated_at: new Date().toISOString() })
            .eq('id', doc.id);

          if (updateError) {
            console.error(`[Vision Queue DEBUG] Failed to finalize document ${doc.id}:`, updateError.message);
          } else {
            console.log(`[Vision Queue DEBUG] ✅ FINALIZED zombie document ${doc.file_name} (${readyChunks}/${totalChunks} chunks ready)`);
            
            // Trigger benchmark assignment if applicable
            const { data: benchmarkRecord, error: bmError } = await supabase
              .from('benchmark_datasets')
              .select('id, suite_category')
              .eq('document_id', doc.id)
              .limit(1);

            // Log for debugging
            if (bmError) {
              console.log(`[Vision Queue DEBUG] Benchmark check error for ${doc.file_name}:`, bmError.message);
            } else {
              console.log(`[Vision Queue DEBUG] Benchmark check for ${doc.file_name}: found ${benchmarkRecord?.length || 0} record(s)`);
            }

            if (benchmarkRecord && benchmarkRecord.length > 0) {
              console.log(`[Vision Queue DEBUG] 🎯 Triggering benchmark assignment for ${doc.file_name}`);
              EdgeRuntime.waitUntil((async () => {
                try {
                  await fetch(`${supabaseUrl}/functions/v1/assign-benchmark-chunks`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${supabaseKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ documentId: doc.id }),
                  });
                } catch (e) {
                  console.error(`[Process Vision Queue] Benchmark assignment failed:`, e);
                }
              })());
            }
          }
        } else {
          console.log(`[Process Vision Queue] Document ${doc.file_name} not ready yet: ${readyChunks || 0}/${totalChunks || 0} chunks ready`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: totalProcessed,
        failed: totalFailed,
        iterations: iteration,
        message: `Processed ${totalProcessed} item(s), ${totalFailed} failed across ${iteration} batch(es)`
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
