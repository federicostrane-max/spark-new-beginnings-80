import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    // Retry logic for transient network errors with exponential backoff
    let assignedLinks = null;
    let retries = 5;
    let backoffMs = 1000;
    
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
      
      // Check for specific database errors
      const errorCode = (linksError as any)?.code;
      const errorMsg = (linksError as any)?.message || '';
      
      console.warn(`[check-and-sync-all] Database error (${retries} retries left):`, {
        code: errorCode,
        message: errorMsg
      });
      
      // If it's a schema cache error or connection issue, retry
      if (errorCode === 'PGRST002' || errorMsg.includes('schema cache') || errorMsg.includes('connection')) {
        retries--;
        if (retries === 0) {
          throw new Error(`Database connection failed after multiple retries: ${errorMsg}`);
        }
        
        console.log(`[check-and-sync-all] Waiting ${backoffMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        backoffMs *= 2; // Exponential backoff
      } else {
        // Non-retryable error
        throw linksError;
      }
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

    // Check if there are too many documents (limit to prevent timeout)
    if (assignedDocIds.size > 100) {
      console.log(`[check-and-sync-all] Too many documents (${assignedDocIds.size}), recommending direct query`);
      return new Response(JSON.stringify({ 
        success: false,
        tooManyDocuments: true,
        count: assignedDocIds.size,
        message: 'Too many documents, please use direct query method'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // STEP 2: Get chunk counts accessible to THIS agent (OPTIMIZED)
    // ========================================
    const agentChunkMap = new Map<string, number>();
    
    // If there are no assigned documents, skip chunk query entirely
    if (assignedDocIds.size === 0) {
      console.log(`[check-and-sync-all] No assigned documents, skipping chunk query`);
    } else {
      // Use aggregate query with retry logic
      let chunkCounts = null;
      let chunkRetries = 3;
      
      while (chunkRetries > 0) {
        const { data, error: chunksError } = await supabase
          .from('agent_knowledge')
          .select('pool_document_id')
          .eq('is_active', true)
          .not('pool_document_id', 'is', null)
          .or(`agent_id.eq.${agentId},agent_id.is.null`)
          .in('pool_document_id', Array.from(assignedDocIds));

        if (!chunksError) {
          chunkCounts = data;
          break;
        }
        
        const errorCode = (chunksError as any)?.code;
        const errorMsg = (chunksError as any)?.message || '';
        
        console.warn(`[check-and-sync-all] Chunk query error (${chunkRetries} retries left):`, {
          code: errorCode,
          message: errorMsg
        });
        
        chunkRetries--;
        if (chunkRetries === 0) {
          console.error('[check-and-sync-all] Chunk query failed after retries, continuing with empty map');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      if (chunkCounts) {
        // Count chunks per document
        chunkCounts.forEach(chunk => {
          if (chunk.pool_document_id) {
            const count = agentChunkMap.get(chunk.pool_document_id) || 0;
            agentChunkMap.set(chunk.pool_document_id, count + 1);
          }
        });
        console.log(`[check-and-sync-all] Found chunks for ${agentChunkMap.size} documents (${chunkCounts.length || 0} total chunks)`);
      }
    }


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

      // Sync missing documents with timeout per document
      if (missingDocs.length > 0) {
        console.log(`[check-and-sync-all] Syncing ${missingDocs.length} missing documents`);
        
        for (const docId of missingDocs) {
          try {
            // Add timeout for each sync operation (60 seconds per document)
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Sync timeout after 60s')), 60000)
            );
            
            const syncPromise = supabase.functions.invoke('sync-pool-document', {
              body: {
                documentId: docId,
                agentId: agentId,
              },
            });

            const { data: syncResult, error: syncError } = await Promise.race([
              syncPromise,
              timeoutPromise
            ]) as any;

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
            const errorMsg = syncErr instanceof Error ? syncErr.message : 'Unknown error';
            console.error(`[check-and-sync-all] Exception syncing ${docId}:`, syncErr);
            errors.push(`Failed to sync ${docNameMap.get(docId)}: ${errorMsg}`);
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
    
    // Categorize error type for better debugging
    let errorType = 'UNKNOWN_ERROR';
    let errorDetails = error instanceof Error ? error.message : 'Unknown error';
    
    if (error instanceof Error) {
      if (error.message.includes('timeout') || error.message.includes('Sync timeout')) {
        errorType = 'TIMEOUT';
        errorDetails = 'Operation timed out. Try processing fewer documents at once.';
      } else if (error.message.includes('network') || error.message.includes('connection')) {
        errorType = 'NETWORK_ERROR';
        errorDetails = 'Network connection error. Please try again.';
      } else if (error.message.includes('database') || error.message.includes('postgres')) {
        errorType = 'DATABASE_ERROR';
      }
    }
    
    return new Response(JSON.stringify({ 
      error: 'Check sync error',
      errorType,
      details: errorDetails,
      stack: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});