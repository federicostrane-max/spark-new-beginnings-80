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

// ===== BATCH TRACE REPORT INTERFACE =====
interface BatchTraceReport {
  batch_index: number;
  pages_processed: number;
  page_range: { start: number; end: number };
  llamaparse_job_id: string | null;
  processing_time_ms: number;
  text_extraction: {
    super_document_chars: number;
    ordered_elements: number;
  };
  chunking: {
    text_chunks_created: number;
    visual_chunks_created: number;
    total_chunks: number;
  };
  visual_enrichment: {
    images_found: number;
    images_skipped_size: number;
    images_enqueued: number;
  };
  completed_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  // ✅ FIX 1: Extract jobId BEFORE try block for error handling access
  let savedJobId: string | null = null;
  let savedDocumentId: string | null = null;

  try {
    const body = await req.json();
    savedJobId = body.jobId;

    if (!savedJobId) {
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

    console.log(`[Process Batch] Starting job: ${savedJobId}`);

    // Fetch job details
    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('id', savedJobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to fetch job: ${jobError?.message || 'Not found'}`);
    }

    // Save document_id for error handling
    savedDocumentId = job.document_id;

    // Update job status to processing
    await supabase
      .from('processing_jobs')
      .update({ status: 'processing' })
      .eq('id', savedJobId);

    // Get extraction mode from job metadata
    const extractionMode = job.metadata?.extraction_mode || 'auto';
    const forcePremium = extractionMode === 'multimodal' || extractionMode === 'premium';
    console.log(`[Process Batch] Processing batch ${job.batch_index} (pages ${job.page_start}-${job.page_end}) [mode: ${extractionMode}]`);

    // Initialize trace report tracking
    let llamaparseJobId: string | null = null;
    let imagesSkippedSize = 0;

    // Download batch PDF
    const { data: batchBlob, error: downloadError } = await supabase.storage
      .from('pipeline-a-uploads')
      .download(job.input_file_path);

    if (downloadError || !batchBlob) {
      throw new Error(`Failed to download batch: ${downloadError?.message}`);
    }

    const batchPdfBuffer = new Uint8Array(await batchBlob.arrayBuffer());
    console.log(`[Process Batch] Downloaded batch (${batchPdfBuffer.length} bytes)`);

    // ===== PHASE 1: JSON EXTRACTION (mode-aware) =====
    // Pass anthropicKey as vendor API key for multimodal OCR when forcePremium is enabled
    const vendorApiKey = forcePremium ? anthropicKey : undefined;
    console.log(`[Process Batch] Calling LlamaParse JSON extraction (forcePremium: ${forcePremium}, hasVendorKey: ${!!vendorApiKey})`);
    const jsonResult = await extractJsonWithLayoutAndCallback(
      batchPdfBuffer,
      `batch_${job.batch_index}.pdf`,
      llamaApiKey,
      async (jobIdFromLlama: string) => {
        llamaparseJobId = jobIdFromLlama;
        console.log(`[Process Batch] LlamaParse job created: ${jobIdFromLlama}`);
      },
      forcePremium,
      vendorApiKey  // <-- Pass Anthropic key for multimodal OCR
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
    let imagesFound = 0;
    
    if (anthropicKey && jsonResult.rawJson?.pages) {
      console.log(`[Process Batch] Scanning for visual elements (max ${MAX_IMAGES_PER_DOC})...`);
      
      for (const page of jsonResult.rawJson.pages) {
        if (!page.images || page.images.length === 0) continue;
        
        for (const image of page.images) {
          // Count total images found
          if (VISUAL_ELEMENT_TYPES.includes(image.type)) {
            imagesFound++;
          }
          
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
                imagesSkippedSize++;
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
      // NOTE: NO placeholder concatenation - visual chunks created separately below
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

    // ===== PHASE 5: CREATE SEPARATE VISUAL CHUNKS =====
    // Each visual element gets its own dedicated chunk for focused embeddings
    console.log(`[Process Batch] Creating ${queuedImagePlaceholders.length} separate visual chunks...`);
    
    let visualChunksCreated = 0;
    for (const placeholder of queuedImagePlaceholders) {
      // Create dedicated visual chunk with waiting_enrichment status
      const visualChunk = {
        document_id: job.document_id,
        chunk_index: (job.batch_index * 10000) + chunksToInsert.length + visualChunksCreated,
        batch_index: job.batch_index,
        chunk_type: 'visual',
        content: `[VISUAL_ENRICHMENT_PENDING: ${placeholder.queueId}]\n(Image: ${placeholder.imageName}, Page: ${placeholder.page})`,
        original_content: null,
        is_atomic: true,
        page_number: placeholder.page + job.page_start - 1,
        heading_hierarchy: null,
        embedding_status: 'waiting_enrichment'
      };
      
      const { data: createdChunk, error: insertError } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .insert(visualChunk)
        .select('id')
        .single();
      
      if (insertError) {
        console.error(`[Process Batch] Failed to create visual chunk for ${placeholder.imageName}:`, insertError);
        continue;
      }
      
      // Immediately link chunk_id to visual_enrichment_queue
      const { error: linkError } = await supabase
        .from('visual_enrichment_queue')
        .update({ chunk_id: createdChunk.id })
        .eq('id', placeholder.queueId);
      
      if (linkError) {
        console.error(`[Process Batch] Failed to link visual chunk to queue ${placeholder.queueId}:`, linkError);
      } else {
        visualChunksCreated++;
        console.log(`[Process Batch] ✓ Created visual chunk ${createdChunk.id} linked to queue ${placeholder.queueId}`);
      }
    }
    
    console.log(`[Process Batch] ✅ Created ${visualChunksCreated}/${queuedImagePlaceholders.length} visual chunks`);
    const totalChunksCreated = chunksToInsert.length + visualChunksCreated;

    // ===== GENERATE BATCH TRACE REPORT =====
    const batchTraceReport: BatchTraceReport = {
      batch_index: job.batch_index,
      pages_processed: job.page_end - job.page_start + 1,
      page_range: { start: job.page_start, end: job.page_end },
      llamaparse_job_id: llamaparseJobId || jsonResult.jobId,
      processing_time_ms: Date.now() - startTime,
      text_extraction: {
        super_document_chars: superDocument.length,
        ordered_elements: orderedElements.length
      },
      chunking: {
        text_chunks_created: chunksToInsert.length,
        visual_chunks_created: visualChunksCreated,
        total_chunks: totalChunksCreated
      },
      visual_enrichment: {
        images_found: imagesFound,
        images_skipped_size: imagesSkippedSize,
        images_enqueued: enqueuedCount
      },
      completed_at: new Date().toISOString()
    };

    console.log(`[Process Batch] 📊 Trace Report: ${JSON.stringify(batchTraceReport)}`);

    // Update job status with trace report in metadata
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        chunks_created: totalChunksCreated,
        completed_at: new Date().toISOString(),
        metadata: {
          ...(job.metadata || {}),
          trace_report: batchTraceReport
        }
      })
      .eq('id', savedJobId);

    console.log(`[Process Batch] Batch ${job.batch_index} completed: ${totalChunksCreated} chunks (${chunksToInsert.length} text + ${visualChunksCreated} visual), ${enqueuedCount} images enqueued`);

    // ===== EVENT-DRIVEN CHAINING: Trigger next batch immediately =====
    const { data: nextJob, error: nextJobError } = await supabase
      .from('processing_jobs')
      .select('id, batch_index')
      .eq('document_id', job.document_id)
      .eq('status', 'pending')
      .order('batch_index', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (nextJob && !nextJobError) {
      console.log(`[Process Batch] ⚡ EVENT-DRIVEN: Triggering next batch ${nextJob.batch_index} (job: ${nextJob.id})`);
      EdgeRuntime.waitUntil(
        supabase.functions.invoke('process-pdf-batch', {
          body: { jobId: nextJob.id }
        }).then(() => {
          console.log(`[Process Batch] Next batch triggered successfully`);
        })
      );
    } else {
      // No more pending batches - trigger aggregation
      console.log(`[Process Batch] All batches completed, triggering aggregation`);
      EdgeRuntime.waitUntil(
        supabase.functions.invoke('aggregate-document-batches', {
          body: { documentId: job.document_id }
        }).then(() => {
          console.log(`[Process Batch] Triggered aggregator for document ${job.document_id}`);
        })
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        jobId: savedJobId,
        batchIndex: job.batch_index,
        chunksCreated: totalChunksCreated,
        textChunks: chunksToInsert.length,
        visualChunks: visualChunksCreated,
        imagesEnqueued: enqueuedCount,
        traceReport: batchTraceReport,
        message: 'Batch processed successfully with visual enrichment'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Process Batch] Unexpected error:', error);

    // ✅ FIX 1 & 3: Use savedJobId (not req.json()) and continue event-driven chain
    if (savedJobId) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        
        // Mark job as failed
        await supabase
          .from('processing_jobs')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date().toISOString()
          })
          .eq('id', savedJobId);

        console.log(`[Process Batch] ⚠️ Job ${savedJobId} marked as failed`);

        // ✅ FIX 3: Continue event-driven chain even on failure!
        // This ensures one failed batch doesn't block the entire document
        if (savedDocumentId) {
          // Check for next pending batch
          const { data: nextJob, error: nextJobError } = await supabase
            .from('processing_jobs')
            .select('id, batch_index')
            .eq('document_id', savedDocumentId)
            .eq('status', 'pending')
            .order('batch_index', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (nextJob && !nextJobError) {
            console.log(`[Process Batch] ⚡ Despite failure, triggering next batch ${nextJob.batch_index} (job: ${nextJob.id})`);
            EdgeRuntime.waitUntil(
              supabase.functions.invoke('process-pdf-batch', {
                body: { jobId: nextJob.id }
              }).catch(err => console.error('[Process Batch] Failed to trigger next batch:', err))
            );
          } else {
            // No more pending batches - trigger aggregation (will mark as partial_failure)
            console.log(`[Process Batch] No more pending batches, triggering aggregation despite failure`);
            EdgeRuntime.waitUntil(
              supabase.functions.invoke('aggregate-document-batches', {
                body: { documentId: savedDocumentId }
              }).catch(err => console.error('[Process Batch] Failed to trigger aggregation:', err))
            );
          }
        }
      } catch (updateError) {
        console.error('[Process Batch] Failed to handle error gracefully:', updateError);
      }
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
