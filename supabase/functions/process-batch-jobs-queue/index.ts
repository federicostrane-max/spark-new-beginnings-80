import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RETRIES = 3;
const STUCK_THRESHOLD_MINUTES = 10;
const FAILED_RECOVERY_THRESHOLD_MINUTES = 10; // Self-healing dopo 10 minuti

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Batch Queue Worker] Starting job queue processing`);

    // Find stuck jobs (processing for >10 minutes) and reset them
    const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const { data: stuckJobs } = await supabase
      .from('processing_jobs')
      .select('id, batch_index, retry_count, document_id')
      .eq('status', 'processing')
      .lt('updated_at', stuckThreshold);

    if (stuckJobs && stuckJobs.length > 0) {
      console.log(`[Batch Queue Worker] Found ${stuckJobs.length} stuck jobs, resetting to pending`);
      
      for (const job of stuckJobs) {
        const retryCount = (job.retry_count || 0) + 1;
        
        if (retryCount > MAX_RETRIES) {
          // Mark as failed after max retries
          await supabase
            .from('processing_jobs')
            .update({
              status: 'failed',
              error_message: `Failed after ${MAX_RETRIES} retries (timeout/stuck)`,
              completed_at: new Date().toISOString()
            })
            .eq('id', job.id);
          
          console.log(`[Batch Queue Worker] Job ${job.id} (batch ${job.batch_index}) marked as failed after ${MAX_RETRIES} retries`);
        } else {
          // Reset to pending for retry
          await supabase
            .from('processing_jobs')
            .update({
              status: 'pending',
              retry_count: retryCount,
              updated_at: new Date().toISOString()
            })
            .eq('id', job.id);
          
          console.log(`[Batch Queue Worker] Job ${job.id} (batch ${job.batch_index}) reset to pending (retry ${retryCount}/${MAX_RETRIES})`);
        }
      }
    }

    // =========================================================================
    // SELF-HEALING: Auto-recovery dei job falliti per billing/transient errors
    // Se un job è fallito da più di 10 minuti, riproviamo assumendo che 
    // l'utente abbia risolto il problema (es. ricaricato crediti LlamaParse)
    // =========================================================================
    const failedRecoveryThreshold = new Date(Date.now() - FAILED_RECOVERY_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    
    const { data: healedJobs, error: healError } = await supabase
      .from('processing_jobs')
      .update({ 
        status: 'pending', 
        retry_count: 0,  // Reset completo per nuova chance
        error_message: null,
        updated_at: new Date().toISOString() 
      })
      .eq('status', 'failed')
      .lt('updated_at', failedRecoveryThreshold)
      .select('id, batch_index');

    if (healError) {
      console.error('[Batch Queue Worker] Error healing failed jobs:', healError);
    } else if (healedJobs && healedJobs.length > 0) {
      console.log(`[Batch Queue Worker] 🩹 Self-healed ${healedJobs.length} old failed jobs for retry`);
    }

    // Fetch one pending job (ordered by document_id, batch_index for sequential processing)
    const { data: pendingJobs, error: fetchError } = await supabase
      .from('processing_jobs')
      .select('id, document_id, batch_index, retry_count')
      .eq('status', 'pending')
      .order('document_id', { ascending: true })
      .order('batch_index', { ascending: true })
      .limit(1);

    if (fetchError) {
      throw new Error(`Failed to fetch pending jobs: ${fetchError.message}`);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log(`[Batch Queue Worker] No pending jobs found`);
      return new Response(
        JSON.stringify({ message: 'No pending jobs', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const job = pendingJobs[0];
    console.log(`[Batch Queue Worker] Processing job ${job.id} (document ${job.document_id}, batch ${job.batch_index}, retry ${job.retry_count || 0})`);
    
    try {
      // Invoke synchronously and wait for completion
      const { data: result, error: invokeError } = await supabase.functions.invoke('process-pdf-batch', {
        body: { jobId: job.id }
      });

      if (invokeError) {
        console.error(`[Batch Queue Worker] Job ${job.id} invocation failed:`, invokeError);
        // Mark job as failed
        await supabase
          .from('processing_jobs')
          .update({
            status: 'failed',
            error_message: invokeError.message || 'Invocation error',
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id);
        
        return new Response(
          JSON.stringify({ success: false, jobId: job.id, error: invokeError.message }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[Batch Queue Worker] Job ${job.id} completed successfully:`, result);
      
      return new Response(
        JSON.stringify({
          success: true,
          processed: 1,
          job: { id: job.id, batch_index: job.batch_index, document_id: job.document_id }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
      
    } catch (error) {
      console.error(`[Batch Queue Worker] Unexpected error processing job ${job.id}:`, error);
      // Mark job as failed
      await supabase
        .from('processing_jobs')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
      
      return new Response(
        JSON.stringify({ success: false, jobId: job.id, error: error instanceof Error ? error.message : 'Unknown error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('[Batch Queue Worker] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
