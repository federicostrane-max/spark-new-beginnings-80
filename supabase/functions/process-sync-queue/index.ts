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

  try {
    console.log('[process-sync-queue] 🚀 Starting batch sync processing...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse optional request body
    let batchSize = 50;
    let maxRetries = 3;
    try {
      const body = await req.json();
      if (body.batchSize && typeof body.batchSize === 'number') {
        batchSize = Math.min(body.batchSize, 100);
      }
      if (body.maxRetries && typeof body.maxRetries === 'number') {
        maxRetries = Math.min(body.maxRetries, 5);
      }
    } catch {
      // No body or invalid JSON, use default
    }

    console.log(`[process-sync-queue] Config: batchSize=${batchSize}, maxRetries=${maxRetries}`);

    // ========================================
    // STEP 1: Fetch pending AND stale syncing docs
    // ========================================
    const STALE_TIMEOUT_MINUTES = 10;
    const staleTime = new Date(Date.now() - STALE_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    
    // Reset stale 'syncing' documents to 'pending'
    const { error: resetError } = await supabase
      .from('agent_document_links')
      .update({ 
        sync_status: 'pending',
        sync_error: 'Timeout: sync took longer than 10 minutes'
      })
      .eq('sync_status', 'syncing')
      .lt('sync_started_at', staleTime);

    if (resetError) {
      console.error('[process-sync-queue] Error resetting stale syncs:', resetError);
    }

    const { data: pendingLinks, error: fetchError } = await supabase
      .from('agent_document_links')
      .select('document_id, agent_id, sync_status, sync_started_at, sync_error')
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
        let attempt = 0;
        let lastError: string | null = null;

        while (attempt < maxRetries) {
          attempt++;
          try {
            console.log(`[process-sync-queue] Syncing ${link.document_id} → ${link.agent_id} (attempt ${attempt}/${maxRetries})`);
            
            // Set timeout for sync operation
            const syncPromise = supabase.functions.invoke('sync-pool-document', {
              body: {
                documentId: link.document_id,
                agentId: link.agent_id
              }
            });

            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Sync timeout after 30s')), 30000)
            );

            const { data, error } = await Promise.race([syncPromise, timeoutPromise]) as any;

            if (error) {
              lastError = error.message || 'Unknown error';
              console.error(`[process-sync-queue] Attempt ${attempt} failed for ${link.document_id}:`, error);
              
              if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
                continue;
              }
              
              stats.failedCount++;
              stats.errors.push({
                documentId: link.document_id,
                agentId: link.agent_id,
                error: `Failed after ${maxRetries} attempts: ${lastError}`
              });
              
              // Mark as permanently failed
              await supabase
                .from('agent_document_links')
                .update({ 
                  sync_status: 'failed',
                  sync_error: `Failed after ${maxRetries} attempts: ${lastError}`,
                  sync_completed_at: new Date().toISOString()
                })
                .eq('document_id', link.document_id)
                .eq('agent_id', link.agent_id);
              
              break;
            }

            if (data?.error) {
              lastError = data.error;
              
              // Some errors are not retryable
              if (data.error.includes('DOCUMENT_NOT_READY') || data.error.includes('DOCUMENT_NOT_FOUND')) {
                console.error(`[process-sync-queue] Non-retryable error for ${link.document_id}:`, data.error);
                stats.failedCount++;
                stats.errors.push({
                  documentId: link.document_id,
                  agentId: link.agent_id,
                  error: data.error
                });
                break;
              }
              
              if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                continue;
              }
              
              stats.failedCount++;
              stats.errors.push({
                documentId: link.document_id,
                agentId: link.agent_id,
                error: `Failed after ${maxRetries} attempts: ${lastError}`
              });
              break;
            }

            // Success!
            console.log(`[process-sync-queue] ✓ Successfully synced ${link.document_id} (${data?.chunksCount || 0} chunks)`);
            stats.successCount++;
            break;

          } catch (syncError) {
            lastError = syncError instanceof Error ? syncError.message : 'Unknown exception';
            console.error(`[process-sync-queue] Exception on attempt ${attempt} for ${link.document_id}:`, syncError);
            
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
              continue;
            }
            
            stats.failedCount++;
            stats.errors.push({
              documentId: link.document_id,
              agentId: link.agent_id,
              error: `Exception after ${maxRetries} attempts: ${lastError}`
            });
            
            // Mark as failed
            await supabase
              .from('agent_document_links')
              .update({ 
                sync_status: 'failed',
                sync_error: lastError,
                sync_completed_at: new Date().toISOString()
              })
              .eq('document_id', link.document_id)
              .eq('agent_id', link.agent_id);
          }
        }

        stats.totalProcessed++;
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
