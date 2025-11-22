import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { categorizeError } from "../_shared/errorCategories.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QueueStats {
  totalProcessed: number;
  successCount: number;
  failedCount: number;
  errors: Array<{ documentId: string; agentId: string; error: string }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let logId: string | undefined;

  try {
    console.log('[process-sync-queue] 🚀 Starting batch sync processing...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse optional request body for batch size
    let batchSize = 50; // Default batch size
    try {
      const body = await req.json();
      if (body.batchSize && typeof body.batchSize === 'number') {
        batchSize = Math.min(body.batchSize, 100); // Max 100 per batch
      }
    } catch {
      // No body or invalid JSON, use default
    }

    console.log(`[process-sync-queue] Batch size: ${batchSize}`);

    // ========================================
    // STEP 1: Fetch all pending syncs
    // ========================================
    const { data: pendingLinks, error: fetchError } = await supabase
      .from('agent_document_links')
      .select('document_id, agent_id, sync_status, sync_started_at')
      .eq('sync_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (fetchError) {
      console.error('[process-sync-queue] Error fetching pending links:', fetchError);
      throw fetchError;
    }

    if (!pendingLinks || pendingLinks.length === 0) {
      console.log('[process-sync-queue] ✅ No pending documents to sync');
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending documents',
        stats: {
          totalProcessed: 0,
          successCount: 0,
          failedCount: 0,
          errors: []
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[process-sync-queue] Found ${pendingLinks.length} documents to sync`);

    // ========================================
    // STEP 2: Process each document
    // ========================================
    const stats: QueueStats = {
      totalProcessed: 0,
      successCount: 0,
      failedCount: 0,
      errors: []
    };

    // Process in smaller batches to avoid overwhelming the system
    const CONCURRENT_LIMIT = 5;
    
    for (let i = 0; i < pendingLinks.length; i += CONCURRENT_LIMIT) {
      const batch = pendingLinks.slice(i, i + CONCURRENT_LIMIT);
      console.log(`[process-sync-queue] Processing batch ${Math.floor(i / CONCURRENT_LIMIT) + 1}/${Math.ceil(pendingLinks.length / CONCURRENT_LIMIT)}`);

      const batchPromises = batch.map(async (link) => {
        try {
          console.log(`[process-sync-queue] Syncing document ${link.document_id} to agent ${link.agent_id}`);
          
          const { data, error } = await supabase.functions.invoke('sync-pool-document', {
            body: {
              documentId: link.document_id,
              agentId: link.agent_id
            }
          });

          if (error) {
            console.error(`[process-sync-queue] Sync failed for ${link.document_id}:`, error);
            stats.failedCount++;
            stats.errors.push({
              documentId: link.document_id,
              agentId: link.agent_id,
              error: error.message || 'Unknown error'
            });
          } else if (data?.error) {
            console.error(`[process-sync-queue] Sync returned error for ${link.document_id}:`, data.error);
            stats.failedCount++;
            stats.errors.push({
              documentId: link.document_id,
              agentId: link.agent_id,
              error: data.error
            });
          } else {
            console.log(`[process-sync-queue] ✓ Successfully synced ${link.document_id} (${data?.chunksCount || 0} chunks)`);
            stats.successCount++;
          }

          stats.totalProcessed++;
        } catch (syncError) {
          console.error(`[process-sync-queue] Exception syncing ${link.document_id}:`, syncError);
          stats.failedCount++;
          stats.errors.push({
            documentId: link.document_id,
            agentId: link.agent_id,
            error: syncError instanceof Error ? syncError.message : 'Unknown exception'
          });
          stats.totalProcessed++;
        }
      });

      // Wait for current batch to complete before starting next
      await Promise.all(batchPromises);
      
      // Small delay between batches to avoid rate limits
      if (i + CONCURRENT_LIMIT < pendingLinks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[process-sync-queue] ✅ Batch complete in ${duration}ms`);
    console.log(`[process-sync-queue] Stats:`, stats);

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${stats.totalProcessed} documents`,
      stats,
      durationMs: duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorCategory = categorizeError(error);
    
    console.error('[process-sync-queue] Fatal error:', error);
    console.error('[process-sync-queue] Error category:', errorCategory);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCategory,
      durationMs: duration
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
