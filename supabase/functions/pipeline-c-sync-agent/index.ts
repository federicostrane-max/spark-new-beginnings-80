import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, documentIds } = await req.json();

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: 'agentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Pipeline C Sync] Starting sync for agent ${agentId}`);

    // Verify agent exists
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, name')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: 'Agent not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build query for ready chunks
    let chunksQuery = supabase
      .from('pipeline_c_chunks_raw')
      .select('id, document_id')
      .eq('embedding_status', 'ready');

    // Filter by documentIds if provided
    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      chunksQuery = chunksQuery.in('document_id', documentIds);
    }

    const { data: chunks, error: chunksError } = await chunksQuery;

    if (chunksError) {
      console.error('[Pipeline C Sync] Error fetching chunks:', chunksError);
      return new Response(
        JSON.stringify({ error: chunksError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!chunks || chunks.length === 0) {
      console.log('[Pipeline C Sync] No ready chunks found for sync');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No ready chunks available for sync',
          agentId,
          chunksSynced: 0,
          documentsProcessed: 0,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline C Sync] Found ${chunks.length} ready chunks to sync`);

    // Prepare sync records
    const syncRecords = chunks.map(chunk => ({
      agent_id: agentId,
      chunk_id: chunk.id,
      is_active: true,
      synced_at: new Date().toISOString(),
    }));

    // Upsert into pipeline_c_agent_knowledge
    const { error: syncError } = await supabase
      .from('pipeline_c_agent_knowledge')
      .upsert(syncRecords, {
        onConflict: 'agent_id,chunk_id',
        ignoreDuplicates: false,
      });

    if (syncError) {
      console.error('[Pipeline C Sync] Error syncing chunks:', syncError);
      return new Response(
        JSON.stringify({ error: syncError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Count unique documents processed
    const uniqueDocIds = new Set(chunks.map(c => c.document_id));

    console.log(`[Pipeline C Sync] ✅ Successfully synced ${chunks.length} chunks from ${uniqueDocIds.size} documents to agent ${agent.name}`);

    return new Response(
      JSON.stringify({
        success: true,
        agentId,
        agentName: agent.name,
        chunksSynced: chunks.length,
        documentsProcessed: uniqueDocIds.size,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline C Sync] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
