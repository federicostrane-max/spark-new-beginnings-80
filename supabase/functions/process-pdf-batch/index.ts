import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractMarkdownFromPDF } from "../_shared/llamaParseClient.ts";
import { parseMarkdownElements } from "../_shared/markdownElementParser.ts";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Call LlamaParse for this batch
    const llamaResult = await extractMarkdownFromPDF(
      batchPdfBuffer,
      `batch_${job.batch_index}.pdf`,
      llamaApiKey
    );

    console.log(`[Process Batch] LlamaParse completed for batch ${job.batch_index}`);

    // Parse markdown elements (async function)
    const parseResult = await parseMarkdownElements(llamaResult.markdown, lovableApiKey);
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

    console.log(`[Process Batch] Batch ${job.batch_index} completed: ${chunksToInsert.length} chunks created`);

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
        message: 'Batch processed successfully'
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
