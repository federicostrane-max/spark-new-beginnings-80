import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RETRIES = 3;
const STUCK_THRESHOLD_MINUTES = 10;
const FAILED_RECOVERY_MINUTES = 15;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('[GitHub Jobs Queue] Starting queue processing...');

  try {
    const stats = {
      stuckReset: 0,
      failedRecovered: 0,
      timeoutDocsRecovered: 0,
      processed: 0,
      errors: 0,
    };

    // ==========================================================
    // PHASE 1: Reset stuck jobs (processing for >10 minutes)
    // ==========================================================
    const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    
    const { data: stuckJobs, error: stuckError } = await supabase
      .from('github_processing_jobs')
      .select('id, document_id, file_path, retry_count')
      .eq('status', 'processing')
      .lt('updated_at', stuckThreshold);

    if (stuckError) {
      console.error('[GitHub Jobs Queue] Error fetching stuck jobs:', stuckError);
    } else if (stuckJobs && stuckJobs.length > 0) {
      console.log(`[GitHub Jobs Queue] Found ${stuckJobs.length} stuck jobs, resetting...`);
      
      for (const job of stuckJobs) {
        const newRetryCount = job.retry_count + 1;
        
        if (newRetryCount >= MAX_RETRIES) {
          // Max retries reached - mark as failed
          await supabase
            .from('github_processing_jobs')
            .update({ 
              status: 'failed', 
              error_message: `Max retries (${MAX_RETRIES}) exceeded after stuck in processing`,
              updated_at: new Date().toISOString()
            })
            .eq('id', job.id);
          
          // Also mark document as failed
          await supabase
            .from('pipeline_a_hybrid_documents')
            .update({ 
              status: 'failed',
              error_message: `GitHub job failed after ${MAX_RETRIES} retries`
            })
            .eq('id', job.document_id);
            
          console.log(`[GitHub Jobs Queue] ❌ Job ${job.id} marked as failed (max retries)`);
        } else {
          // Reset to pending for retry
          await supabase
            .from('github_processing_jobs')
            .update({ 
              status: 'pending', 
              retry_count: newRetryCount,
              error_message: `Reset after stuck in processing (attempt ${newRetryCount})`,
              updated_at: new Date().toISOString()
            })
            .eq('id', job.id);
          
          stats.stuckReset++;
          console.log(`[GitHub Jobs Queue] 🔄 Reset stuck job: ${job.file_path} (retry ${newRetryCount})`);
        }
      }
    }

    // ==========================================================
    // PHASE 2: Self-healing failed jobs (after 15 min cooldown)
    // ==========================================================
    const failedThreshold = new Date(Date.now() - FAILED_RECOVERY_MINUTES * 60 * 1000).toISOString();
    
    const { data: failedJobs, error: failedError } = await supabase
      .from('github_processing_jobs')
      .select('id, document_id, file_path, retry_count')
      .eq('status', 'failed')
      .lt('retry_count', MAX_RETRIES)
      .lt('updated_at', failedThreshold)
      .limit(3);

    if (failedError) {
      console.error('[GitHub Jobs Queue] Error fetching failed jobs:', failedError);
    } else if (failedJobs && failedJobs.length > 0) {
      console.log(`[GitHub Jobs Queue] Found ${failedJobs.length} failed jobs to recover...`);
      
      for (const job of failedJobs) {
        await supabase
          .from('github_processing_jobs')
          .update({ 
            status: 'pending',
            error_message: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
        
        // Also reset document status
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({ 
            status: 'ingested',
            error_message: null
          })
          .eq('id', job.document_id);
        
        stats.failedRecovered++;
        console.log(`[GitHub Jobs Queue] 🔄 Recovered failed job: ${job.file_path}`);
      }
    }

    // ==========================================================
    // PHASE 3: Recover timeout-failed documents (no job exists)
    // ==========================================================
    const timeoutThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    const { data: timeoutDocs, error: timeoutError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id, file_name')
      .eq('status', 'failed')
      .ilike('error_message', '%timeout%')
      .lt('updated_at', timeoutThreshold)
      .limit(3);

    if (timeoutError) {
      console.error('[GitHub Jobs Queue] Error fetching timeout docs:', timeoutError);
    } else if (timeoutDocs && timeoutDocs.length > 0) {
      console.log(`[GitHub Jobs Queue] Found ${timeoutDocs.length} timeout-failed documents to recover...`);
      
      for (const doc of timeoutDocs) {
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({ 
            status: 'ingested',
            error_message: null
          })
          .eq('id', doc.id);
        
        stats.timeoutDocsRecovered++;
        console.log(`[GitHub Jobs Queue] 🔄 Recovered timeout document: ${doc.file_name}`);
      }
    }

    // ==========================================================
    // PHASE 4: Process ONE pending job (sequential, no overload)
    // ==========================================================
    const { data: pendingJobs, error: pendingError } = await supabase
      .from('github_processing_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (pendingError) {
      console.error('[GitHub Jobs Queue] Error fetching pending jobs:', pendingError);
      throw pendingError;
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log('[GitHub Jobs Queue] No pending jobs found');
      return new Response(
        JSON.stringify({ success: true, message: 'No pending jobs', stats }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const job = pendingJobs[0];
    console.log(`[GitHub Jobs Queue] Processing job: ${job.file_path} (document: ${job.document_id})`);

    // Mark job as processing
    await supabase
      .from('github_processing_jobs')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id);

    // Invoke process-chunks synchronously
    const { error: processError } = await supabase.functions.invoke('pipeline-a-hybrid-process-chunks', {
      body: { documentId: job.document_id }
    });

    if (processError) {
      console.error(`[GitHub Jobs Queue] ❌ Process error for ${job.file_path}:`, processError);
      
      const newRetryCount = job.retry_count + 1;
      
      await supabase
        .from('github_processing_jobs')
        .update({ 
          status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending',
          retry_count: newRetryCount,
          error_message: processError.message || 'Unknown processing error',
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
      
      stats.errors++;
    } else {
      // Success - mark as completed
      await supabase
        .from('github_processing_jobs')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
      
      stats.processed++;
      console.log(`[GitHub Jobs Queue] ✅ Successfully processed: ${job.file_path}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        processedJob: job.file_path,
        stats 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[GitHub Jobs Queue] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
