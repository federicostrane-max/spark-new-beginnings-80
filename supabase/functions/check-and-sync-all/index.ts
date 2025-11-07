import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CheckSyncRequest {
  agentId: string;
  autoFix?: boolean; // If true, automatically fix discrepancies
}

interface SyncStatus {
  documentId: string;
  fileName: string;
  isAssigned: boolean;
  chunkCount: number;
  status: 'synced' | 'missing' | 'orphaned' | 'syncing' | 'failed';
  message?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate request body
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('[check-and-sync-all] Invalid JSON in request body:', parseError);
      return new Response(JSON.stringify({ 
        error: 'Invalid request body',
        details: 'Request body must be valid JSON'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { agentId, autoFix = false }: CheckSyncRequest = body;

    console.log(`[check-and-sync-all] Checking sync status for agent ${agentId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ========================================
    // STEP 1: Get all assigned documents from agent_document_links
    // ========================================
    // Retry logic for transient network errors
    let assignedLinks = null;
    let retries = 3;
    
    while (retries > 0) {
      const { data, error: linksError } = await supabase
        .from('agent_document_links')
        .select(`
          document_id,
          sync_status,
          sync_started_at,
          sync_error,
          knowledge_documents (
            id,
            file_name
          )
        `)
        .eq('agent_id', agentId);

      if (!linksError) {
        assignedLinks = data;
        break;
      }
      
      retries--;
      if (retries === 0) throw linksError;
      
      console.warn(`[check-and-sync-all] Retry fetching links (${retries} left):`, linksError);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const assignedDocIds = new Set<string>();
    const docNameMap = new Map<string, string>();
    const docSyncStatusMap = new Map<string, any>();

    assignedLinks?.forEach(link => {
      const docId = link.document_id;
      assignedDocIds.add(docId);
      
      // Store sync status info
      docSyncStatusMap.set(docId, {
        sync_status: link.sync_status || 'completed',
        sync_started_at: link.sync_started_at,
        sync_error: link.sync_error
      });
      
      // Handle case where document might be deleted but link still exists
      if (link.knowledge_documents && typeof link.knowledge_documents === 'object') {
        const docData = link.knowledge_documents as any;
        if (docData.file_name) {
          docNameMap.set(docId, docData.file_name);
        } else {
          console.warn(`[check-and-sync-all] Document ${docId} has no file_name`);
          docNameMap.set(docId, `Unknown Document (${docId.substring(0, 8)})`);
        }
      } else {
        console.warn(`[check-and-sync-all] Document ${docId} not found in knowledge_documents table`);
        docNameMap.set(docId, `Missing Document (${docId.substring(0, 8)})`);
      }
    });

    console.log(`[check-and-sync-all] Found ${assignedDocIds.size} assigned documents`);

    // ========================================
    // STEP 2: Get chunk counts for THIS agent only
    // ========================================
    const { data: agentChunks, error: chunksError } = await supabase
      .from('agent_knowledge')
      .select('pool_document_id')
      .eq('agent_id', agentId)
      .not('pool_document_id', 'is', null)
      .limit(10000);

    if (chunksError) {
      console.error('[check-and-sync-all] Error fetching chunks:', chunksError);
      throw chunksError;
    }

    const agentChunkMap = new Map<string, number>();
    agentChunks?.forEach(chunk => {
      if (chunk.pool_document_id) {
        const count = agentChunkMap.get(chunk.pool_document_id) || 0;
        agentChunkMap.set(chunk.pool_document_id, count + 1);
      }
    });

    console.log(`[check-and-sync-all] Agent has chunks for ${agentChunkMap.size} documents`);

    // ========================================
    // STEP 3: Find discrepancies (considering sync_status)
    // ========================================
    const statuses: SyncStatus[] = [];
    const missingDocs: string[] = [];
    const orphanedDocs: string[] = [];

    // Check assigned documents - simplified check without per-doc queries
    for (const docId of assignedDocIds) {
      const agentChunkCount = agentChunkMap.get(docId) || 0;
      const fileName = docNameMap.get(docId) || 'Unknown';
      const syncInfo = docSyncStatusMap.get(docId) || { sync_status: 'completed' };
      const syncStatus = syncInfo.sync_status;
      const syncStartedAt = syncInfo.sync_started_at;
      const syncError = syncInfo.sync_error;
      
      // Check if actively syncing
      const isSyncing = syncStatus === 'pending' || syncStatus === 'syncing';
      const isRecentlyStarted = syncStartedAt && (Date.now() - new Date(syncStartedAt).getTime() < 60000); // 60s
      
      if (agentChunkCount === 0) {
        // Distinguish between syncing, failed, and genuinely missing
        if (isSyncing && isRecentlyStarted) {
          statuses.push({
            documentId: docId,
            fileName,
            isAssigned: true,
            chunkCount: 0,
            status: 'syncing',
            message: `Sync in progress (${syncStatus})`
          });
        } else if (syncStatus === 'failed') {
          missingDocs.push(docId);
          statuses.push({
            documentId: docId,
            fileName,
            isAssigned: true,
            chunkCount: 0,
            status: 'failed',
            message: `Sync failed: ${syncError || 'Unknown error'}`
          });
        } else {
          missingDocs.push(docId);
          statuses.push({
            documentId: docId,
            fileName,
            isAssigned: true,
            chunkCount: 0,
            status: 'missing',
            message: 'Document assigned but no chunks found'
          });
        }
      } else {
        statuses.push({
          documentId: docId,
          fileName,
          isAssigned: true,
          chunkCount: agentChunkCount,
          status: 'synced',
          message: `Document synced with ${agentChunkCount} chunks`
        });
      }
    }

    // Check for orphaned documents (in agent_knowledge but not assigned)
    for (const [docId, chunkCount] of agentChunkMap.entries()) {
      if (!assignedDocIds.has(docId)) {
        orphanedDocs.push(docId);
        statuses.push({
          documentId: docId,
          fileName: 'Orphaned Document',
          isAssigned: false,
          chunkCount,
          status: 'orphaned',
        });
      }
    }

    console.log(`[check-and-sync-all] Missing: ${missingDocs.length}, Orphaned: ${orphanedDocs.length}`);

    // ========================================
    // STEP 4: Auto-fix if requested
    // ========================================
    let fixedCount = 0;
    const errors: string[] = [];

    if (autoFix) {
      // Remove orphaned chunks
      if (orphanedDocs.length > 0) {
        console.log(`[check-and-sync-all] Removing ${orphanedDocs.length} orphaned documents`);
        
        const { error: deleteError } = await supabase
          .from('agent_knowledge')
          .delete()
          .eq('agent_id', agentId)
          .eq('source_type', 'shared_pool')
          .in('pool_document_id', orphanedDocs);

        if (deleteError) {
          console.error('[check-and-sync-all] Error deleting orphaned chunks:', deleteError);
          errors.push(`Failed to delete orphaned chunks: ${deleteError.message}`);
        } else {
          fixedCount += orphanedDocs.length;
        }
      }

      // Sync missing documents
      if (missingDocs.length > 0) {
        console.log(`[check-and-sync-all] Syncing ${missingDocs.length} missing documents`);
        
        for (const docId of missingDocs) {
          try {
            const { data: syncResult, error: syncError } = await supabase.functions.invoke('sync-pool-document', {
              body: {
                documentId: docId,
                agentId: agentId,
              },
            });

            if (syncError) {
              console.error(`[check-and-sync-all] Error syncing ${docId}:`, syncError);
              errors.push(`Failed to sync ${docNameMap.get(docId)}: ${syncError.message || 'Sync error'}`);
              continue;
            }

            if (syncResult?.error) {
              console.error(`[check-and-sync-all] Sync returned error for ${docId}:`, syncResult.error);
              errors.push(`Failed to sync ${docNameMap.get(docId)}: ${syncResult.message || syncResult.error}`);
              continue;
            }

            console.log(`[check-and-sync-all] Synced ${docId}: ${syncResult?.chunksCount || 0} chunks`);
            fixedCount++;
          } catch (syncErr) {
            console.error(`[check-and-sync-all] Exception syncing ${docId}:`, syncErr);
            errors.push(`Failed to sync ${docNameMap.get(docId)}: ${syncErr instanceof Error ? syncErr.message : 'Unknown error'}`);
          }
        }
      }
    }

    // ========================================
    // STEP 5: Return results
    // ========================================
    return new Response(JSON.stringify({ 
      success: true,
      agentId,
      totalAssigned: assignedDocIds.size,
      totalSynced: agentChunkMap.size,
      missingCount: missingDocs.length,
      orphanedCount: orphanedDocs.length,
      statuses,
      autoFix,
      fixedCount,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[check-and-sync-all] Error:', error);
    console.error('[check-and-sync-all] Error stack:', error instanceof Error ? error.stack : 'N/A');
    
    // Better error serialization
    let errorMessage = 'Check sync error';
    let errorDetails = 'Unknown error';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || error.message;
    } else if (typeof error === 'object' && error !== null) {
      try {
        errorDetails = JSON.stringify(error, null, 2);
        errorMessage = (error as any).message || errorMessage;
      } catch {
        errorDetails = String(error);
      }
    } else {
      errorDetails = String(error);
    }
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      details: errorDetails
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});