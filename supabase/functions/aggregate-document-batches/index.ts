import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractTextWithClaudeVision, chunkOCROutput } from "../_shared/claudeVisionOCR.ts";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== SELF-HEALING: Page-Chunk Ratio Check Thresholds =====
const MIN_CHUNKS_PER_PAGE_RATIO = 0.5;  // At least 0.5 chunks per page
const MIN_ABSOLUTE_CHUNKS = 10;          // Minimum 10 chunks for multi-page docs
const MIN_PAGES_FOR_RATIO_CHECK = 5;     // Skip ratio check for small documents
const MAX_EXTRACTION_ATTEMPTS = 2;       // Prevent infinite retry loops

// ===== GENERATE META CHUNK CONTENT =====
function generateMetaChunkContent(fileName: string, report: AggregatedTraceReport): string {
  const s = report.summary;
  const lines: string[] = [];
  
  lines.push(`## 📋 Processing Report: ${fileName}`);
  lines.push(``);
  lines.push(`**Processing Path:** Batch (${report.total_batches} batches)`);
  lines.push(`**Total Pages:** ${s.total_pages}`);
  lines.push(`**Extraction Mode:** ${report.extraction_mode || 'auto'}`);
  lines.push(``);
  
  // Chunking Stats
  lines.push(`### Chunking Statistics`);
  lines.push(`- **Total Chunks:** ${s.total_chunks}`);
  lines.push(`- **Text Chunks:** ${s.text_chunks}`);
  lines.push(`- **Visual Chunks:** ${s.visual_chunks}`);
  lines.push(`- **Super-Document Size:** ${(s.super_document_total_chars / 1000).toFixed(1)}K chars`);
  lines.push(``);
  
  // Visual Enrichment
  lines.push(`### Visual Enrichment`);
  lines.push(`- **Elements Found:** ${s.total_visual_elements_found}`);
  lines.push(`- **Elements Enqueued:** ${s.total_visual_elements_enqueued}`);
  if (s.total_visual_elements_skipped > 0) {
    lines.push(`- **Elements Skipped (size):** ${s.total_visual_elements_skipped}`);
  }
  lines.push(``);
  
  // Processing Time
  lines.push(`### Processing`);
  lines.push(`- **Total Time:** ${(s.total_processing_time_ms / 1000).toFixed(1)}s`);
  lines.push(`- **Completed:** ${new Date(report.aggregated_at).toLocaleString('en-US')}`);
  
  return lines.join('\n');
}

// ===== AGGREGATED TRACE REPORT INTERFACE =====
interface AggregatedTraceReport {
  document_id: string;
  processing_path: 'batch';
  total_batches: number;
  batches: any[];
  extraction_mode?: string;
  summary: {
    total_pages: number;
    total_chunks: number;
    text_chunks: number;
    visual_chunks: number;
    total_visual_elements_found: number;
    total_visual_elements_enqueued: number;
    total_visual_elements_skipped: number;
    total_processing_time_ms: number;
    super_document_total_chars: number;
  };
  aggregated_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();

    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'documentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Aggregator] Checking completion status for document: ${documentId}`);

    // Fetch ALL job data including metadata for trace reports
    const { data: jobs, error: jobsError } = await supabase
      .from('processing_jobs')
      .select('status, chunks_created, batch_index, metadata')
      .eq('document_id', documentId)
      .order('batch_index', { ascending: true });

    if (jobsError) {
      throw new Error(`Failed to fetch jobs: ${jobsError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      console.log(`[Aggregator] No jobs found for document ${documentId} - likely not a batch-processed document`);
      return new Response(
        JSON.stringify({ message: 'No jobs found', documentId }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const totalJobs = jobs.length;
    const completedJobs = jobs.filter(j => j.status === 'completed').length;
    const failedJobs = jobs.filter(j => j.status === 'failed').length;
    const pendingJobs = jobs.filter(j => j.status === 'pending' || j.status === 'processing').length;
    const totalChunks = jobs.reduce((sum, j) => sum + (j.chunks_created || 0), 0);

    console.log(`[Aggregator] Job status - Total: ${totalJobs}, Completed: ${completedJobs}, Failed: ${failedJobs}, Pending: ${pendingJobs}`);

    // Determine final document status
    let documentStatus: string;
    let statusMessage: string;

    if (pendingJobs > 0) {
      // Still processing
      console.log(`[Aggregator] Document ${documentId} still has ${pendingJobs} pending jobs`);
      return new Response(
        JSON.stringify({
          message: 'Processing in progress',
          documentId,
          completedJobs,
          totalJobs,
          pendingJobs
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (completedJobs === totalJobs) {
      // All completed successfully
      documentStatus = 'chunked';
      statusMessage = `All ${totalJobs} batches completed successfully, ${totalChunks} chunks created`;
      console.log(`[Aggregator] ✅ Document ${documentId} fully processed: ${statusMessage}`);
    } else if (completedJobs > 0 && failedJobs > 0) {
      // Partial success
      documentStatus = 'partial_failure';
      statusMessage = `Partial processing: ${completedJobs}/${totalJobs} batches succeeded, ${failedJobs} failed`;
      console.warn(`[Aggregator] ⚠️ Document ${documentId} partially failed: ${statusMessage}`);
    } else {
      // All failed
      documentStatus = 'failed';
      statusMessage = `All ${totalJobs} batches failed`;
      console.error(`[Aggregator] ❌ Document ${documentId} completely failed: ${statusMessage}`);
    }

    // ===== FETCH DOCUMENT INFO FOR RATIO CHECK =====
    const { data: docData } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('file_name, extraction_mode, extraction_attempts, processing_metadata, page_count')
      .eq('id', documentId)
      .single();

    // Use page_count from document, fallback to processing_metadata, then 0
    const totalPages = docData?.page_count || docData?.processing_metadata?.total_pages || 0;
    const currentMode = docData?.extraction_mode || 'auto';
    const extractionAttempts = docData?.extraction_attempts || 0;
    
    console.log(`[Aggregator] Document info: pages=${totalPages}, mode=${currentMode}, attempts=${extractionAttempts}, chunks=${totalChunks}`);

    // ===== SELF-HEALING: Page-Chunk Ratio Check =====
    let shouldRetryWithMultimodal = false;
    let ratioCheckResult = { passed: true, ratio: 0, reason: '' };

    if (documentStatus === 'chunked' && totalPages >= MIN_PAGES_FOR_RATIO_CHECK) {
      const ratio = totalChunks / totalPages;
      ratioCheckResult.ratio = ratio;

      if (ratio < MIN_CHUNKS_PER_PAGE_RATIO || totalChunks < MIN_ABSOLUTE_CHUNKS) {
        ratioCheckResult.passed = false;
        ratioCheckResult.reason = `ratio=${ratio.toFixed(2)} (min: ${MIN_CHUNKS_PER_PAGE_RATIO}), chunks=${totalChunks} (min: ${MIN_ABSOLUTE_CHUNKS})`;

        console.log(`[Aggregator] ⚠️ RATIO CHECK FAILED: ${ratioCheckResult.reason}`);

        if (currentMode === 'auto' && extractionAttempts < MAX_EXTRACTION_ATTEMPTS) {
          shouldRetryWithMultimodal = true;
          console.log(`[Aggregator] 🔄 Will retry with MULTIMODAL mode (attempt ${extractionAttempts + 1}/${MAX_EXTRACTION_ATTEMPTS})`);
        } else if (extractionAttempts >= MAX_EXTRACTION_ATTEMPTS) {
          console.error(`[Aggregator] ❌ Max extraction attempts reached (${extractionAttempts}), marking as failed`);
          documentStatus = 'failed';
          statusMessage = `Extraction failed after ${extractionAttempts} attempts - insufficient content extracted`;
        }
      } else {
        console.log(`[Aggregator] ✅ RATIO CHECK PASSED: ${totalChunks} chunks / ${totalPages} pages = ${ratio.toFixed(2)} ratio`);
      }
    }

    // ===== IF RETRY NEEDED: Use Claude Vision OCR directly =====
    if (shouldRetryWithMultimodal) {
      console.log(`[Aggregator] 🔄 SELF-HEALING: Using Claude Vision OCR (bypassing LlamaParse)...`);

      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!anthropicKey) {
        console.error(`[Aggregator] ❌ ANTHROPIC_API_KEY not set, cannot use Claude OCR fallback`);
        documentStatus = 'failed';
      } else {
        // 1. Get document file path
        const { data: docInfo } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('file_path, storage_bucket')
          .eq('id', documentId)
          .single();

        if (!docInfo?.file_path) {
          console.error(`[Aggregator] ❌ No file_path for document ${documentId}`);
          documentStatus = 'failed';
        } else {
          // 2. Download PDF from storage
          console.log(`[Aggregator] 📥 Downloading PDF from ${docInfo.storage_bucket}/${docInfo.file_path}`);
          const { data: pdfData, error: downloadError } = await supabase.storage
            .from(docInfo.storage_bucket || 'pipeline-a-hybrid-uploads')
            .download(docInfo.file_path);

          if (downloadError || !pdfData) {
            console.error(`[Aggregator] ❌ Failed to download PDF:`, downloadError?.message);
            documentStatus = 'failed';
          } else {
            // 3. Run Claude Vision OCR
            const pdfBuffer = new Uint8Array(await pdfData.arrayBuffer());
            console.log(`[Aggregator] 🔍 Running Claude Vision OCR on ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB PDF`);

            const ocrResult = await extractTextWithClaudeVision(pdfBuffer, {
              anthropicKey,
              fileName: docData?.file_name || 'unknown.pdf'
            });

            if (!ocrResult.success) {
              console.error(`[Aggregator] ❌ Claude OCR failed: ${ocrResult.errorMessage}`);
              documentStatus = 'failed';
              
              // Update document with error
              await supabase
                .from('pipeline_a_hybrid_documents')
                .update({
                  status: 'failed',
                  error_message: `Claude OCR failed: ${ocrResult.errorMessage}`,
                  extraction_attempts: extractionAttempts + 1
                })
                .eq('id', documentId);
            } else {
              console.log(`[Aggregator] ✅ Claude OCR success: ${ocrResult.text.length} chars in ${ocrResult.processingTimeMs}ms`);

              // 4. Delete existing failed chunks
              await supabase
                .from('pipeline_a_hybrid_chunks_raw')
                .delete()
                .eq('document_id', documentId);
              console.log(`[Aggregator] Deleted ${totalChunks} failed chunks`);

              // 5. Create new chunks from OCR output
              const ocrChunks = chunkOCROutput(ocrResult.text);
              console.log(`[Aggregator] Creating ${ocrChunks.length} chunks from OCR output`);

              const chunksToInsert = ocrChunks.map(chunk => ({
                document_id: documentId,
                chunk_index: chunk.chunkIndex,
                chunk_type: 'text',
                content: chunk.content,
                embedding_status: 'pending',
                is_atomic: false
              }));

              const { error: insertError } = await supabase
                .from('pipeline_a_hybrid_chunks_raw')
                .insert(chunksToInsert);

              if (insertError) {
                console.error(`[Aggregator] ❌ Failed to insert OCR chunks:`, insertError.message);
                documentStatus = 'failed';
              } else {
                console.log(`[Aggregator] ✅ Inserted ${ocrChunks.length} OCR chunks`);

                // 6. Update document status
                documentStatus = 'chunked';
                await supabase
                  .from('pipeline_a_hybrid_documents')
                  .update({
                    status: 'chunked',
                    extraction_mode: 'claude_ocr',
                    extraction_attempts: extractionAttempts + 1,
                    page_count: ocrResult.pageCount,
                    processing_metadata: {
                      ...docData?.processing_metadata,
                      claude_ocr_used: true,
                      ocr_chars_extracted: ocrResult.text.length,
                      ocr_processing_time_ms: ocrResult.processingTimeMs,
                      ocr_chunks_created: ocrChunks.length,
                      retry_reason: ratioCheckResult.reason,
                      previous_mode: currentMode,
                      previous_chunks: totalChunks
                    }
                  })
                  .eq('id', documentId);

                // 7. Trigger embedding generation
                console.log(`[Aggregator] ⚡ Triggering embedding generation for OCR chunks...`);
                EdgeRuntime.waitUntil(
                  supabase.functions.invoke('pipeline-a-hybrid-generate-embeddings', {
                    body: { documentId }
                  }).then(() => {
                    console.log(`[Aggregator] ✅ Embedding generation triggered for ${documentId}`);
                  })
                );

                return new Response(
                  JSON.stringify({
                    success: true,
                    documentId,
                    action: 'claude_ocr_fallback',
                    reason: ratioCheckResult.reason,
                    previousMode: currentMode,
                    previousChunks: totalChunks,
                    newChunks: ocrChunks.length,
                    ocrCharsExtracted: ocrResult.text.length,
                    message: `Low extraction detected, recovered with Claude Vision OCR`
                  }),
                  { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
              }
            }
          }
        }
      }
    }

    // ===== AGGREGATE TRACE REPORTS FROM ALL BATCHES =====
    const batchTraceReports = jobs
      .filter(j => j.metadata?.trace_report)
      .map(j => j.metadata.trace_report);

    console.log(`[Aggregator] Found ${batchTraceReports.length} batch trace reports to aggregate`);

    // Calculate aggregated summary
    const aggregatedTraceReport: AggregatedTraceReport = {
      document_id: documentId,
      processing_path: 'batch',
      total_batches: totalJobs,
      batches: batchTraceReports,
      extraction_mode: currentMode,
      summary: {
        total_pages: batchTraceReports.reduce((sum, r) => sum + (r.pages_processed || 0), 0),
        total_chunks: batchTraceReports.reduce((sum, r) => sum + (r.chunking?.total_chunks || 0), 0),
        text_chunks: batchTraceReports.reduce((sum, r) => sum + (r.chunking?.text_chunks_created || 0), 0),
        visual_chunks: batchTraceReports.reduce((sum, r) => sum + (r.chunking?.visual_chunks_created || 0), 0),
        total_visual_elements_found: batchTraceReports.reduce((sum, r) => sum + (r.visual_enrichment?.images_found || 0), 0),
        total_visual_elements_enqueued: batchTraceReports.reduce((sum, r) => sum + (r.visual_enrichment?.images_enqueued || 0), 0),
        total_visual_elements_skipped: batchTraceReports.reduce((sum, r) => sum + (r.visual_enrichment?.images_skipped_size || 0), 0),
        total_processing_time_ms: batchTraceReports.reduce((sum, r) => sum + (r.processing_time_ms || 0), 0),
        super_document_total_chars: batchTraceReports.reduce((sum, r) => sum + (r.text_extraction?.super_document_chars || 0), 0)
      },
      aggregated_at: new Date().toISOString()
    };

    console.log(`[Aggregator] 📊 Aggregated Trace Report Summary:`, JSON.stringify(aggregatedTraceReport.summary));

    // Update document status with aggregated trace report
    const { error: updateError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .update({
        status: documentStatus,
        processing_metadata: {
          aggregated_at: new Date().toISOString(),
          total_batches: totalJobs,
          completed_batches: completedJobs,
          failed_batches: failedJobs,
          total_chunks: totalChunks,
          message: statusMessage,
          trace_report: aggregatedTraceReport,
          ratio_check: ratioCheckResult
        }
      })
      .eq('id', documentId);

    if (updateError) {
      throw new Error(`Failed to update document: ${updateError.message}`);
    }

    console.log(`[Aggregator] ✅ Saved aggregated trace report for ${documentId}`);

    // ===== INSERT META CHUNK WITH PROCESSING TRACE REPORT =====
    // Generate Markdown summary for agent self-awareness
    const metaChunkContent = generateMetaChunkContent(docData?.file_name || 'Unknown', aggregatedTraceReport);
    
    // Get max chunk_index for this document
    const { data: maxChunkData } = await supabase
      .from('pipeline_a_hybrid_chunks_raw')
      .select('chunk_index')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: false })
      .limit(1)
      .single();

    const nextChunkIndex = (maxChunkData?.chunk_index || 0) + 1;

    // Insert meta chunk
    const { error: metaInsertError } = await supabase
      .from('pipeline_a_hybrid_chunks_raw')
      .insert({
        document_id: documentId,
        chunk_index: nextChunkIndex,
        chunk_type: 'meta',
        content: metaChunkContent,
        embedding_status: 'pending',
        is_atomic: true
      });

    if (metaInsertError) {
      console.error(`[Aggregator] Failed to insert meta chunk: ${metaInsertError.message}`);
    } else {
      console.log(`[Aggregator] ✅ Inserted meta chunk for ${docData?.file_name}`);
    }

    // If successfully chunked, trigger embedding generation
    if (documentStatus === 'chunked') {
      EdgeRuntime.waitUntil(
        supabase.functions.invoke('pipeline-a-hybrid-generate-embeddings', {
          body: { documentId }
        }).then(() => {
          console.log(`[Aggregator] Triggered embedding generation for document ${documentId}`);
        })
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        documentStatus,
        completedJobs,
        failedJobs,
        totalJobs,
        totalChunks,
        traceReport: aggregatedTraceReport.summary,
        message: statusMessage
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Aggregator] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
