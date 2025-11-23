import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    console.log('[cleanup-orphaned-links] Starting cleanup of orphaned document links');

    // Call the cleanup function
    const { data: deletedLinks, error: cleanupError } = await supabaseClient
      .rpc('cleanup_orphaned_document_links');

    if (cleanupError) {
      console.error('[cleanup-orphaned-links] Error during cleanup:', cleanupError);
      throw cleanupError;
    }

    const deletedCount = deletedLinks?.length || 0;
    console.log(`[cleanup-orphaned-links] Deleted ${deletedCount} orphaned links`);

    // Also cleanup orphaned chunks (chunks referencing non-existent documents)
    const { data: orphanedChunks, error: chunkError } = await supabaseClient
      .from('agent_knowledge')
      .select('id, pool_document_id, document_name, agent_id')
      .not('pool_document_id', 'is', null);

    if (chunkError) {
      console.error('[cleanup-orphaned-links] Error fetching chunks:', chunkError);
      throw chunkError;
    }

    // Filter chunks where document doesn't exist
    const chunksToDelete = [];
    for (const chunk of orphanedChunks || []) {
      const { data: docExists } = await supabaseClient
        .from('knowledge_documents')
        .select('id')
        .eq('id', chunk.pool_document_id)
        .maybeSingle();

      if (!docExists) {
        chunksToDelete.push(chunk.id);
      }
    }

    let deletedChunksCount = 0;
    if (chunksToDelete.length > 0) {
      const { error: deleteChunksError } = await supabaseClient
        .from('agent_knowledge')
        .delete()
        .in('id', chunksToDelete);

      if (deleteChunksError) {
        console.error('[cleanup-orphaned-links] Error deleting orphaned chunks:', deleteChunksError);
        throw deleteChunksError;
      }

      deletedChunksCount = chunksToDelete.length;
      console.log(`[cleanup-orphaned-links] Deleted ${deletedChunksCount} orphaned chunks`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        deletedLinksCount: deletedCount,
        deletedChunksCount,
        deletedLinks: deletedLinks || [],
        message: `Cleanup completed: ${deletedCount} orphaned links and ${deletedChunksCount} orphaned chunks removed`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('[cleanup-orphaned-links] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorDetails = error instanceof Error ? error.toString() : String(error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        details: errorDetails
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
