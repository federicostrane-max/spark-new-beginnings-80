import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAGES_PER_BATCH = 20;

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

      const { error: uploadError } = await supabase.storage
        .from('pipeline-a-uploads')
        .upload(batchFilePath, batchPdfBytes, {
          contentType: 'application/pdf',
          upsert: true  // Allow re-processing by overwriting existing batches
        });

      if (uploadError) {
        console.error(`[Split PDF] Failed to upload batch ${batchIndex}:`, uploadError);
        throw new Error(`Batch upload failed: ${uploadError.message}`);
      }

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

      console.log(`[Split PDF] Created job ${job.id} for batch ${batchIndex} - worker will process via cron`);
    }

    console.log(`[Split PDF] Successfully created ${totalBatches} batches for document ${documentId}`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        totalPages,
        totalBatches,
        message: `Split into ${totalBatches} batches, processing started`
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
