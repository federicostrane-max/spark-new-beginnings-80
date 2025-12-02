import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { extractJsonWithLayoutAndCallback, downloadJobImage } from "../_shared/llamaParseClient.ts";
import { reconstructFromLlamaParse } from "../_shared/documentReconstructor.ts";
import { parseMarkdownElements } from "../_shared/markdownElementParser.ts";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== ARCHITECTURAL CONSTANTS =====
const MAX_IMAGES_PER_DOC = 50;  // 🛡️ Prevent queue overflow on large documents
const VISUAL_ELEMENT_TYPES = ['layout_picture', 'layout_table', 'layout_keyValueRegion'];
const MAX_IMAGE_SIZE_MB = 5;    // Skip images larger than this

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId } = await req.json();

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: 'jobId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const llamaApiKey = Deno.env.get('LLAMA_CLOUD_API_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Process Batch] Starting job: ${jobId}`);

    // Fetch job details
    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to fetch job: ${jobError?.message || 'Not found'}`);
    }

    // Update job status to processing
    await supabase
      .from('processing_jobs')
      .update({ status: 'processing' })
      .eq('id', jobId);

    console.log(`[Process Batch] Processing batch ${job.batch_index} (pages ${job.page_start}-${job.page_end})`);

    // Download batch PDF
    const { data: batchBlob, error: downloadError } = await supabase.storage
      .from('pipeline-a-uploads')
      .download(job.input_file_path);

    if (downloadError || !batchBlob) {
      throw new Error(`Failed to download batch: ${downloadError?.message}`);
    }

    const batchPdfBuffer = new Uint8Array(await batchBlob.arrayBuffer());
    console.log(`[Process Batch] Downloaded batch (${batchPdfBuffer.length} bytes)`);

    // ===== PHASE 1: JSON EXTRACTION (was Markdown-only before) =====
    console.log(`[Process Batch] Calling LlamaParse JSON extraction for batch ${job.batch_index}`);
    const jsonResult = await extractJsonWithLayoutAndCallback(
      batchPdfBuffer,
      `batch_${job.batch_index}.pdf`,
      llamaApiKey,
      async (llamaJobId: string) => {
        console.log(`[Process Batch] LlamaParse job created: ${llamaJobId}`);
      }
    );

    console.log(`[Process Batch] LlamaParse completed for batch ${job.batch_index}`);
    console.log(`[Process Batch] JSON has ${jsonResult.rawJson?.pages?.length || 0} pages, ${jsonResult.rawJson?.items?.length || 0} items`);

    // ===== PHASE 2: DOCUMENT RECONSTRUCTION =====
    const { superDocument, orderedElements } = reconstructFromLlamaParse(jsonResult.rawJson);
    let mutableSuperDocument = superDocument;
    console.log(`[Process Batch] Reconstructed super-document: ${superDocument.length} chars, ${orderedElements.length} elements`);

    // ===== PHASE 3: VISUAL ENRICHMENT QUEUE =====
    const queuedImagePlaceholders: Array<{ imageName: string; queueId: string; page: number }> = [];
    let enqueuedCount = 0;
    
    if (anthropicKey && jsonResult.rawJson?.pages) {
      console.log(`[Process Batch] Scanning for visual elements (max ${MAX_IMAGES_PER_DOC})...`);
      
      for (const page of jsonResult.rawJson.pages) {
        if (!page.images || page.images.length === 0) continue;
        
        for (const image of page.images) {
          // 🛡️ STOP if we hit the limit
          if (enqueuedCount >= MAX_IMAGES_PER_DOC) {
            console.log(`[Process Batch] ⚠️ MAX_IMAGES limit reached (${MAX_IMAGES_PER_DOC}), stopping image queue`);
            break;
          }
          
          if (VISUAL_ELEMENT_TYPES.includes(image.type)) {
            try {
              // Download image from LlamaParse
              const imageBuffer = await downloadJobImage(jsonResult.jobId, image.name, llamaApiKey);
              const imageSizeMB = imageBuffer.length / (1024 * 1024);
              
              // Skip if image too large
              if (imageSizeMB > MAX_IMAGE_SIZE_MB) {
                console.log(`[Process Batch] ⚠️ SKIPPED ${image.name} - Size ${imageSizeMB.toFixed(2)}MB exceeds ${MAX_IMAGE_SIZE_MB}MB`);
                continue;
              }
              
              // Encode image to base64
              const base64Image = encodeBase64(imageBuffer);
              
              // Insert into visual_enrichment_queue
              const { data: queueEntry, error: queueError } = await supabase
                .from('visual_enrichment_queue')
                .insert({
                  document_id: job.document_id,
                  image_base64: base64Image,
                  image_metadata: {
                    image_name: image.name,
                    type: image.type,
                    page: page.page,
                    batch_index: job.batch_index,
                    llamaparse_job_id: jsonResult.jobId
                  },
                  status: 'pending'
                })
                .select('id')
                .single();
              
              if (queueError) {
                console.error(`[Process Batch] Failed to enqueue ${image.name}:`, queueError);
                continue;
              }
              
              // Store queue ID for placeholder insertion
              queuedImagePlaceholders.push({
                imageName: image.name,
                queueId: queueEntry.id,
                page: page.page
              });
              
              enqueuedCount++;
              console.log(`[Process Batch] ✓ Enqueued ${image.name} (queue_id: ${queueEntry.id}) [${enqueuedCount}/${MAX_IMAGES_PER_DOC}]`);
              
              // 🚀 EVENT-DRIVEN: Invoke worker immediately for this image
              try {
                EdgeRuntime.waitUntil(
                  supabase.functions.invoke('process-vision-job', {
                    body: { queueItemId: queueEntry.id }
                  })
                );
              } catch (invokeError) {
                console.warn(`[Process Batch] Failed to invoke worker for ${queueEntry.id}:`, invokeError);
              }
              
            } catch (error: any) {
              console.error(`[Process Batch] Error processing ${image.name}:`, error.message);
            }
          }
        }
        
        // 🛡️ BREAK outer loop if limit reached
        if (enqueuedCount >= MAX_IMAGES_PER_DOC) break;
      }
      
      console.log(`[Process Batch] ✅ Enqueued ${enqueuedCount} images for visual enrichment`);
      
      // Insert placeholders into superDocument for each enqueued image
      for (const placeholder of queuedImagePlaceholders) {
        const placeholderText = `\n\n[VISUAL_ENRICHMENT_PENDING: ${placeholder.queueId}]\n(Image: ${placeholder.imageName}, Page: ${placeholder.page})\n\n`;
        mutableSuperDocument += placeholderText;
      }
    } else {
      console.log('[Process Batch] Visual enrichment skipped (no ANTHROPIC_API_KEY or no pages)');
    }

    // ===== PHASE 4: MARKDOWN PARSING & CHUNKING =====
    console.log(`[Process Batch] Parsing markdown elements from super-document...`);
    const parseResult = await parseMarkdownElements(mutableSuperDocument, lovableApiKey);
    const elements = parseResult.baseNodes;
    console.log(`[Process Batch] Parsed ${elements.length} elements from batch ${job.batch_index}`);

    // Fetch document to get file_name for embedding context
    const { data: document } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('file_name')
      .eq('id', job.document_id)
      .single();

    // Insert chunks with batch_index for ordering
    const chunksToInsert = elements.map((element, idx) => ({
      document_id: job.document_id,
      chunk_index: (job.batch_index * 10000) + idx, // Ensure global ordering across batches
      batch_index: job.batch_index,
      chunk_type: element.chunk_type,
      content: element.content,
      original_content: element.original_content,
      is_atomic: element.is_atomic,
      page_number: element.page_number ? element.page_number + job.page_start - 1 : null, // Adjust page numbers
      heading_hierarchy: element.heading_hierarchy,
      embedding_status: 'pending'
    }));

    if (chunksToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .insert(chunksToInsert);

      if (insertError) {
        throw new Error(`Failed to insert chunks: ${insertError.message}`);
      }
    }

    // Update job status
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        chunks_created: chunksToInsert.length,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    console.log(`[Process Batch] Batch ${job.batch_index} completed: ${chunksToInsert.length} chunks, ${enqueuedCount} images enqueued`);

    // Trigger aggregation check (event-driven)
    EdgeRuntime.waitUntil(
      supabase.functions.invoke('aggregate-document-batches', {
        body: { documentId: job.document_id }
      }).then(() => {
        console.log(`[Process Batch] Triggered aggregator for document ${job.document_id}`);
      })
    );

    return new Response(
      JSON.stringify({
        success: true,
        jobId,
        batchIndex: job.batch_index,
        chunksCreated: chunksToInsert.length,
        imagesEnqueued: enqueuedCount,
        message: 'Batch processed successfully with visual enrichment'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Process Batch] Unexpected error:', error);

    // Mark job as failed if we have jobId
    try {
      const { jobId } = await req.json();
      if (jobId) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        await supabase
          .from('processing_jobs')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date().toISOString()
          })
          .eq('id', jobId);
      }
    } catch (updateError) {
      console.error('[Process Batch] Failed to update job status:', updateError);
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
