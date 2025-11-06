import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[cleanup-orphaned-chunks] ========== START ==========');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ========================================
    // STEP 1: Find orphaned chunks using optimized SQL function
    // ========================================
    console.log('[cleanup-orphaned-chunks] Finding orphaned chunks...');
    
    const { data: orphanedChunks, error: queryError } = await supabase
      .rpc('find_orphaned_chunks');

    if (queryError) throw queryError;

    console.log(`[cleanup-orphaned-chunks] Found ${orphanedChunks?.length || 0} orphaned chunks`);

    // Collect IDs and metadata
    const orphanedIds: string[] = [];
    const affectedAgents = new Set<string>();
    const affectedDocuments = new Set<string>();

    if (orphanedChunks && orphanedChunks.length > 0) {
      for (const chunk of orphanedChunks) {
        orphanedIds.push(chunk.chunk_id);
        affectedAgents.add(chunk.agent_id);
        affectedDocuments.add(chunk.pool_document_id);
        
        console.log(`[cleanup-orphaned-chunks] Orphaned chunk: ${chunk.chunk_id.slice(0, 8)}... (agent: ${chunk.agent_id.slice(0, 8)}, doc: ${chunk.document_name})`);
      }
    }

    console.log(`[cleanup-orphaned-chunks] Identified ${orphanedIds.length} orphaned chunks`);
    console.log(`[cleanup-orphaned-chunks] Affected agents: ${affectedAgents.size}`);
    console.log(`[cleanup-orphaned-chunks] Affected documents: ${affectedDocuments.size}`);

    if (orphanedIds.length === 0) {
      console.log('[cleanup-orphaned-chunks] No orphaned chunks to clean');
      return new Response(JSON.stringify({
        success: true,
        deleted: 0,
        affectedAgents: 0,
        affectedDocuments: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // STEP 2: Delete orphaned chunks in batches
    // ========================================
    console.log('[cleanup-orphaned-chunks] Deleting orphaned chunks in batches...');
    
    const BATCH_SIZE = 100;
    let totalDeleted = 0;

    for (let i = 0; i < orphanedIds.length; i += BATCH_SIZE) {
      const batch = orphanedIds.slice(i, i + BATCH_SIZE);
      console.log(`[cleanup-orphaned-chunks] Deleting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(orphanedIds.length / BATCH_SIZE)} (${batch.length} chunks)`);

      const { error: deleteError } = await supabase
        .from('agent_knowledge')
        .delete()
        .in('id', batch);

      if (deleteError) {
        console.error('[cleanup-orphaned-chunks] Error deleting batch:', deleteError);
        throw deleteError;
      }

      totalDeleted += batch.length;
    }

    console.log(`[cleanup-orphaned-chunks] ✓ Successfully deleted ${totalDeleted} orphaned chunks`);
    console.log('[cleanup-orphaned-chunks] ========== END SUCCESS ==========');

    return new Response(JSON.stringify({
      success: true,
      deleted: totalDeleted,
      affectedAgents: affectedAgents.size,
      affectedDocuments: affectedDocuments.size
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[cleanup-orphaned-chunks] ❌ ERROR:', error);
    console.error('[cleanup-orphaned-chunks] Stack:', (error as Error).stack);
    console.log('[cleanup-orphaned-chunks] ========== END ERROR ==========');

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Cleanup error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
