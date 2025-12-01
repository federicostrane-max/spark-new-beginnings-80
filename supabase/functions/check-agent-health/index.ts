import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HealthStatus {
  agentId: string;
  totalDocuments: number;
  syncedDocuments: number;
  pendingDocuments: number;
  failedDocuments: number;
  hasIssues: boolean;
  documents: Array<{
    documentId: string;
    fileName: string;
    chunkCount: number;
    syncStatus: string;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { agentId } = await req.json();

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: 'agentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[check-agent-health] Checking health for agent: ${agentId}`);

    // Add 15-second timeout to prevent hanging requests
    const rpcPromise = supabase.rpc('get_agent_sync_status', { p_agent_id: agentId });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('RPC timeout after 15 seconds')), 15000)
    );

    let syncStatus, rpcError;
    try {
      const result = await Promise.race([rpcPromise, timeoutPromise]);
      syncStatus = (result as any).data;
      rpcError = (result as any).error;
    } catch (timeoutError) {
      console.error('[check-agent-health] RPC timeout:', timeoutError);
      // Return graceful degraded response instead of failing
      const degradedHealth = {
        agentId,
        totalDocuments: 0,
        syncedDocuments: 0,
        pendingDocuments: 0,
        failedDocuments: 0,
        hasIssues: false,
        documents: [],
        degraded: true,
        message: 'Health check incomplete - status unavailable'
      };
      return new Response(
        JSON.stringify({ success: true, health: degradedHealth }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (rpcError) {
      console.error('[check-agent-health] RPC error:', rpcError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch agent sync status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const documents = syncStatus || [];
    const totalDocuments = documents.length;
    const syncedDocuments = documents.filter((d: any) => d.sync_status === 'completed').length;
    const pendingDocuments = documents.filter((d: any) => d.sync_status === 'pending').length;
    const failedDocuments = documents.filter((d: any) => d.sync_status === 'failed').length;
    const hasIssues = failedDocuments > 0 || pendingDocuments > 0;

    const health: HealthStatus = {
      agentId,
      totalDocuments,
      syncedDocuments,
      pendingDocuments,
      failedDocuments,
      hasIssues,
      documents: documents.map((d: any) => ({
        documentId: d.document_id,
        fileName: d.document_name || 'unknown',
        chunkCount: Number(d.chunk_count || 0),
        syncStatus: d.sync_status
      }))
    };

    console.log(`[check-agent-health] ✅ Health check complete:`, {
      total: totalDocuments,
      synced: syncedDocuments,
      pending: pendingDocuments,
      failed: failedDocuments
    });

    return new Response(
      JSON.stringify({ success: true, health }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[check-agent-health] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
