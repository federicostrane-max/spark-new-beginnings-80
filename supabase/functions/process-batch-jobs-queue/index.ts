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

    // =========================================================================
    // PHASE 1: Find stuck jobs (processing for >10 minutes) and reset them
    // =========================================================================
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
    // PHASE 2: SELF-HEALING - Auto-recovery dei job falliti per billing/transient errors
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

    // =========================================================================
    // PHASE 3: AGGREGATION SWEEPER - Sblocca documenti "zombie"
    // Documenti con TUTTI i batch completati ma status non ancora finale
    // Questo cattura i casi in cui l'event-driven fallisce (timeout/rete)
    // =========================================================================
    console.log(`[Batch Queue Worker] 🧹 Running Aggregation Sweeper...`);

    const { data: zombieDocuments, error: zombieError } = await supabase
      .rpc('find_zombie_documents_for_aggregation');

    if (zombieError) {
      console.error('[Batch Queue Worker] Error finding zombie documents:', zombieError);
    } else if (zombieDocuments && zombieDocuments.length > 0) {
      console.log(`[Batch Queue Worker] 🧟 Found ${zombieDocuments.length} zombie documents needing aggregation`);
      
      for (const doc of zombieDocuments) {
        console.log(`[Batch Queue Worker] Re-triggering aggregation for: ${doc.file_name} (${doc.document_id})`);
        
        try {
          const { error: aggError } = await supabase.functions.invoke('aggregate-document-batches', {
            body: { documentId: doc.document_id }
          });
          
          if (aggError) {
            console.error(`[Batch Queue Worker] Aggregation failed for ${doc.file_name}:`, aggError);
          } else {
            console.log(`[Batch Queue Worker] ✅ Aggregation triggered for ${doc.file_name}`);
          }
        } catch (err) {
          console.error(`[Batch Queue Worker] Exception triggering aggregation for ${doc.file_name}:`, err);
        }
      }
    } else {
      console.log(`[Batch Queue Worker] ✅ No zombie documents found`);
    }

    // =========================================================================
    // PHASE 4: INGESTED ORPHAN RECOVERY - Documenti bloccati in 'ingested'
    // Quando split-pdf-into-batches fallisce silenziosamente, il documento
    // rimane 'ingested' senza processing_jobs. Questo phase lo recupera.
    // =========================================================================
    const INGESTED_ORPHAN_THRESHOLD_MINUTES = 5;
    const ingestedOrphanThreshold = new Date(Date.now() - INGESTED_ORPHAN_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    
    const { data: ingestedOrphans, error: orphanError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('id, file_name')
      .eq('status', 'ingested')
      .eq('source_type', 'pdf')
      .lt('updated_at', ingestedOrphanThreshold)
      .limit(3); // Process max 3 per cycle to avoid overload

    if (orphanError) {
      console.error('[Batch Queue Worker] Error finding ingested orphans:', orphanError);
    } else if (ingestedOrphans && ingestedOrphans.length > 0) {
      console.log(`[Batch Queue Worker] 🔧 Found ${ingestedOrphans.length} ingested orphan documents - re-triggering split`);
      
      for (const orphan of ingestedOrphans) {
        console.log(`[Batch Queue Worker] Re-invoking split-pdf-into-batches for: ${orphan.file_name} (${orphan.id})`);
        
        try {
          const { error: splitError } = await supabase.functions.invoke('split-pdf-into-batches', {
            body: { documentId: orphan.id }
          });
          
          if (splitError) {
            console.error(`[Batch Queue Worker] Split failed for ${orphan.file_name}:`, splitError);
            // Mark as failed to prevent infinite retry loops
            await supabase
              .from('pipeline_a_hybrid_documents')
              .update({ 
                status: 'failed', 
                error_message: `Split failed after orphan recovery: ${splitError.message}` 
              })
              .eq('id', orphan.id);
          } else {
            console.log(`[Batch Queue Worker] ✅ Split re-triggered for ${orphan.file_name}`);
          }
        } catch (err) {
          console.error(`[Batch Queue Worker] Exception re-triggering split for ${orphan.file_name}:`, err);
        }
      }
    } else {
      console.log(`[Batch Queue Worker] ✅ No ingested orphans found`);
    }

    // =========================================================================
    // PHASE 5: Process next pending job (one at a time for sequential processing)
    // =========================================================================
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
        JSON.stringify({ 
          message: 'No pending jobs', 
          processed: 0,
          zombiesFound: zombieDocuments?.length || 0 
        }),
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
          job: { id: job.id, batch_index: job.batch_index, document_id: job.document_id },
          zombiesFound: zombieDocuments?.length || 0
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
