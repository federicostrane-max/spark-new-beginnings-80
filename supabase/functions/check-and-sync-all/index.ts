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
  status: 'synced' | 'missing' | 'orphaned';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, autoFix = false }: CheckSyncRequest = await req.json();

    console.log(`[check-and-sync-all] Checking sync status for agent ${agentId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ========================================
    // STEP 1: Get all assigned documents from agent_document_links
    // ========================================
    const { data: assignedLinks, error: linksError } = await supabase
      .from('agent_document_links')
      .select(`
        document_id,
        knowledge_documents (
          id,
          file_name
        )
      `)
      .eq('agent_id', agentId);

    if (linksError) throw linksError;

    const assignedDocIds = new Set<string>();
    const docNameMap = new Map<string, string>();

    assignedLinks?.forEach(link => {
      const docId = link.document_id;
      assignedDocIds.add(docId);
      if (link.knowledge_documents) {
        docNameMap.set(docId, (link.knowledge_documents as any).file_name);
      }
    });

    console.log(`[check-and-sync-all] Found ${assignedDocIds.size} assigned documents`);

    // ========================================
    // STEP 2: Get chunk counts grouped by document from agent_knowledge
    // ========================================
    // IMPORTANTE: Prendiamo TUTTI i chunks che hanno pool_document_id non null,
    // indipendentemente dal source_type perché durante la clonazione potrebbero
    // avere source_type diversi ma essere comunque chunks validi del pool
    const { data: chunkCounts, error: chunksError } = await supabase
      .from('agent_knowledge')
      .select('pool_document_id')
      .eq('agent_id', agentId)
      .not('pool_document_id', 'is', null)
      .limit(100000); // High limit to get all chunks

    if (chunksError) {
      console.error('[check-and-sync-all] Error fetching chunks:', chunksError);
      throw chunksError;
    }

    console.log(`[check-and-sync-all] Total chunk records fetched: ${chunkCounts?.length || 0}`);

    // Group chunks by document manually
    const syncedDocMap = new Map<string, number>();
    chunkCounts?.forEach(chunk => {
      if (chunk.pool_document_id) {
        const count = syncedDocMap.get(chunk.pool_document_id) || 0;
        syncedDocMap.set(chunk.pool_document_id, count + 1);
      }
    });

    console.log(`[check-and-sync-all] Found chunks for ${syncedDocMap.size} documents`);
    console.log('[check-and-sync-all] Document chunk counts:', 
      Array.from(syncedDocMap.entries()).map(([docId, count]) => ({
        docId: docId.substring(0, 8) + '...',
        chunks: count
      }))
    );

    // ========================================
    // STEP 3: Find discrepancies
    // ========================================
    const statuses: SyncStatus[] = [];
    const missingDocs: string[] = [];
    const orphanedDocs: string[] = [];

    // Check assigned documents
    for (const docId of assignedDocIds) {
      const agentChunkCount = syncedDocMap.get(docId) || 0;
      const fileName = docNameMap.get(docId) || 'Unknown';
      
      // Conta i chunk TOTALI disponibili per questo documento
      const { data: allChunksData, error: allChunksError } = await supabase
        .from('agent_knowledge')
        .select('id')
        .eq('pool_document_id', docId);
      
      if (allChunksError) {
        console.error(`[check-and-sync-all] Error counting total chunks for ${docId}:`, allChunksError);
      }
      
      const totalChunks = allChunksData?.length || 0;
      
      if (agentChunkCount === 0) {
        missingDocs.push(docId);
        statuses.push({
          documentId: docId,
          fileName,
          isAssigned: true,
          chunkCount: 0,
          status: 'missing',
        });
      } else if (totalChunks > 0 && agentChunkCount < totalChunks) {
        // NUOVO: Documenti parzialmente sincronizzati
        console.log(`[check-and-sync-all] Partial sync detected: ${fileName} (${agentChunkCount}/${totalChunks} chunks)`);
        statuses.push({
          documentId: docId,
          fileName,
          isAssigned: true,
          chunkCount: agentChunkCount,
          status: 'partial' as any, // Status parziale
        });
      } else {
        statuses.push({
          documentId: docId,
          fileName,
          isAssigned: true,
          chunkCount: agentChunkCount,
          status: 'synced',
        });
      }
    }

    // Check for orphaned documents (in agent_knowledge but not assigned)
    for (const [docId, chunkCount] of syncedDocMap.entries()) {
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
            const syncResponse = await fetch(`${supabaseUrl}/functions/v1/sync-pool-document`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                documentId: docId,
                agentId: agentId,
              }),
            });

            if (!syncResponse.ok) {
              const errorText = await syncResponse.text();
              throw new Error(`Sync failed: ${errorText}`);
            }

            const syncResult = await syncResponse.json();
            console.log(`[check-and-sync-all] Synced ${docId}: ${syncResult.chunksCount} chunks`);
            fixedCount++;
          } catch (error) {
            console.error(`[check-and-sync-all] Error syncing ${docId}:`, error);
            errors.push(`Failed to sync ${docNameMap.get(docId)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      totalSynced: syncedDocMap.size,
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
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Check sync error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});