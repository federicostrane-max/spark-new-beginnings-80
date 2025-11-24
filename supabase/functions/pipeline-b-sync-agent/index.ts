import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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
      throw new Error('agentId is required');
    }

    console.log(`🔄 Pipeline B Sync Agent: ${agentId}`);
    if (documentIds) {
      console.log(`📋 Syncing specific documents: ${documentIds.length}`);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify agent exists
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, name')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      throw new Error('Agent not found');
    }

    console.log(`✓ Agent: ${agent.name}`);

    // Build query for chunks
    let chunksQuery = supabase
      .from('pipeline_b_chunks_raw')
      .select('id, document_id, content, chunk_type')
      .eq('embedding_status', 'ready');

    // Filter by specific documents if provided
    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      chunksQuery = chunksQuery.in('document_id', documentIds);
    }

    const { data: chunks, error: chunksError } = await chunksQuery;

    if (chunksError) throw chunksError;

    if (!chunks || chunks.length === 0) {
      console.log('⚠️ No ready chunks found to sync');
      return new Response(
        JSON.stringify({
          success: true,
          synced: 0,
          message: 'No chunks available for sync',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📦 Found ${chunks.length} ready chunks`);

    // Prepare sync records
    const syncRecords = chunks.map(chunk => ({
      agent_id: agentId,
      chunk_id: chunk.id,
      is_active: true,
    }));

    // Insert sync records (upsert to avoid duplicates)
    const { data: syncedRecords, error: syncError } = await supabase
      .from('pipeline_b_agent_knowledge')
      .upsert(syncRecords, { 
        onConflict: 'agent_id,chunk_id',
        ignoreDuplicates: true 
      })
      .select();

    if (syncError) throw syncError;

    const syncedCount = syncedRecords?.length || 0;

    console.log(`✓ Synced ${syncedCount} chunks to agent ${agent.name}`);

    // Get document counts
    const uniqueDocuments = new Set(chunks.map(c => c.document_id));

    return new Response(
      JSON.stringify({
        success: true,
        synced: syncedCount,
        documentsProcessed: uniqueDocuments.size,
        totalChunks: chunks.length,
        agent: {
          id: agent.id,
          name: agent.name,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Pipeline B Sync Agent error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});