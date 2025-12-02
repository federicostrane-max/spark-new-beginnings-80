import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAGES_PER_BATCH = 20;

// ============= FIX 1: RETRY POLICY - Exponential Backoff per Storage Upload =============
async function uploadWithRetry(
  supabase: any,
  bucket: string,
  path: string,
  data: Uint8Array,
  options: { contentType: string; upsert: boolean },
  maxRetries: number = 3
): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, data, options);
    
    if (!error) {
      if (attempt > 0) {
        console.log(`[Split PDF] ✅ Upload successful on attempt ${attempt + 1}/${maxRetries}`);
      }
      return;
    }
    
    lastError = new Error(error.message);
    console.warn(`[Split PDF] ⚠️ Upload attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
    
    if (attempt < maxRetries - 1) {
      const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
      const jitter = Math.random() * 500; // Add jitter to prevent thundering herd
      console.log(`[Split PDF] Retrying in ${Math.round(backoffMs + jitter)}ms...`);
      await new Promise(r => setTimeout(r, backoffMs + jitter));
    }
  }
  
  console.error(`[Split PDF] ❌ Upload failed after ${maxRetries} attempts`);
  throw lastError || new Error('Upload failed after all retries');
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

    console.log(`[Split PDF] Starting batch split for document: ${documentId}`);

    // Fetch document metadata
    const { data: document, error: docError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error(`Failed to fetch document: ${docError?.message || 'Not found'}`);
    }

    // Download original PDF from storage
    const { data: pdfBlob, error: downloadError } = await supabase.storage
      .from(document.storage_bucket)
      .download(document.file_path);

    if (downloadError || !pdfBlob) {
      throw new Error(`Failed to download PDF: ${downloadError?.message}`);
    }

    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    console.log(`[Split PDF] Downloaded ${pdfBytes.length} bytes`);

    // Load PDF and count pages
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    const totalBatches = Math.ceil(totalPages / PAGES_PER_BATCH);

    console.log(`[Split PDF] Total pages: ${totalPages}, batches: ${totalBatches}`);

    // Update document with processing metadata
    await supabase
      .from('pipeline_a_hybrid_documents')
      .update({
        status: 'splitting',
        processing_metadata: {
          ...document.processing_metadata,
          total_pages: totalPages,
          total_batches: totalBatches,
          pages_per_batch: PAGES_PER_BATCH,
          split_started_at: new Date().toISOString(),
        }
      })
      .eq('id', documentId);

    // Create batches
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const pageStart = batchIndex * PAGES_PER_BATCH;
      const pageEnd = Math.min(pageStart + PAGES_PER_BATCH - 1, totalPages - 1);

      console.log(`[Split PDF] Creating batch ${batchIndex + 1}/${totalBatches} (pages ${pageStart + 1}-${pageEnd + 1})`);

      // Create new PDF for this batch
      const batchDoc = await PDFDocument.create();
      const pagesToCopy = [];
      for (let i = pageStart; i <= pageEnd; i++) {
        pagesToCopy.push(i);
      }
      const copiedPages = await batchDoc.copyPages(pdfDoc, pagesToCopy);
      copiedPages.forEach((page) => batchDoc.addPage(page));

      // Save batch PDF
      const batchPdfBytes = await batchDoc.save();
      const batchFileName = `${document.file_name.replace('.pdf', '')}_batch_${batchIndex}.pdf`;
      const batchFilePath = `batches/${documentId}/${batchFileName}`;

      // FIX 1: Upload with retry policy (exponential backoff)
      await uploadWithRetry(
        supabase,
        'pipeline-a-uploads',
        batchFilePath,
        batchPdfBytes,
        { contentType: 'application/pdf', upsert: true }
      );

      console.log(`[Split PDF] ✅ Batch ${batchIndex} uploaded successfully`);

      // Create processing job
      const { data: job, error: jobError } = await supabase
        .from('processing_jobs')
        .insert({
          document_id: documentId,
          batch_index: batchIndex,
          page_start: pageStart + 1, // 1-indexed for human readability
          page_end: pageEnd + 1,
          total_batches: totalBatches,
          input_file_path: batchFilePath,
          status: 'pending'
        })
        .select()
        .single();

      if (jobError || !job) {
        console.error(`[Split PDF] Failed to create job for batch ${batchIndex}:`, jobError);
        throw new Error(`Job creation failed: ${jobError?.message}`);
      }

      console.log(`[Split PDF] Created job ${job.id} for batch ${batchIndex}`);
    }

    console.log(`[Split PDF] Successfully created ${totalBatches} batches for document ${documentId}`);

    // ===== EVENT-DRIVEN: Trigger first batch immediately (no cron wait) =====
    const { data: firstJob, error: firstJobError } = await supabase
      .from('processing_jobs')
      .select('id')
      .eq('document_id', documentId)
      .eq('batch_index', 0)
      .eq('status', 'pending')
      .single();

    if (firstJob && !firstJobError) {
      console.log(`[Split PDF] ⚡ EVENT-DRIVEN: Triggering first batch immediately (job: ${firstJob.id})`);
      try {
        EdgeRuntime.waitUntil(
          supabase.functions.invoke('process-pdf-batch', {
            body: { jobId: firstJob.id }
          }).then(() => {
            console.log(`[Split PDF] First batch processing triggered`);
          })
        );
      } catch (invokeError) {
        console.warn('[Split PDF] Failed to trigger first batch (cron will handle):', invokeError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        totalPages,
        totalBatches,
        processingMode: 'event-driven',
        message: `Split into ${totalBatches} batches, first batch triggered immediately`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Split PDF] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
