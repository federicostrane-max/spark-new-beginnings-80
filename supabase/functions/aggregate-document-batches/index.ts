import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== AGGREGATED TRACE REPORT INTERFACE =====
interface AggregatedTraceReport {
  document_id: string;
  processing_path: 'batch';
  total_batches: number;
  batches: any[];
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
          trace_report: aggregatedTraceReport
        }
      })
      .eq('id', documentId);

    if (updateError) {
      throw new Error(`Failed to update document: ${updateError.message}`);
    }

    console.log(`[Aggregator] ✅ Saved aggregated trace report for ${documentId}`);

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
