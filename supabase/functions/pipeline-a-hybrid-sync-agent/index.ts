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

    console.log(`[Pipeline A-Hybrid Sync] Syncing chunks for agent ${agentId}`);

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
    let query = supabase
      .from('pipeline_a_hybrid_chunks_raw')
      .select('id, document_id')
      .eq('embedding_status', 'ready');

    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      query = query.in('document_id', documentIds);
      console.log(`[Pipeline A-Hybrid Sync] Filtering by ${documentIds.length} document(s)`);
    }

    const { data: readyChunks, error: chunksError } = await query;

    if (chunksError) {
      throw new Error(`Failed to fetch ready chunks: ${chunksError.message}`);
    }

    if (!readyChunks || readyChunks.length === 0) {
      console.log('[Pipeline A-Hybrid Sync] No ready chunks found');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No ready chunks to sync',
          synced: 0,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline A-Hybrid Sync] Found ${readyChunks.length} ready chunks`);

    // Prepare upsert records
    const recordsToUpsert = readyChunks.map(chunk => ({
      agent_id: agentId,
      chunk_id: chunk.id,
      is_active: true,
      synced_at: new Date().toISOString(),
    }));

    // Upsert into pipeline_a_hybrid_agent_knowledge
    const { error: upsertError } = await supabase
      .from('pipeline_a_hybrid_agent_knowledge')
      .upsert(recordsToUpsert, {
        onConflict: 'agent_id,chunk_id',
        ignoreDuplicates: false,
      });

    if (upsertError) {
      throw new Error(`Failed to sync chunks: ${upsertError.message}`);
    }

    console.log(`[Pipeline A-Hybrid Sync] Successfully synced ${readyChunks.length} chunks to agent ${agent.name}`);

    return new Response(
      JSON.stringify({
        success: true,
        agentId,
        agentName: agent.name,
        synced: readyChunks.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline A-Hybrid Sync] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
