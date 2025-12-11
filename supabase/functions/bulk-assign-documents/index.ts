import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

// Declare EdgeRuntime for TypeScript
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BulkAssignRequest {
  agentId: string;
  documentIds: string[];
  pipeline: 'a' | 'a-hybrid' | 'b' | 'c';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, documentIds, pipeline } = await req.json() as BulkAssignRequest;

    if (!agentId) {
      throw new Error('agentId is required');
    }

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      throw new Error('documentIds array is required and must not be empty');
    }

    console.log(`🚀 Bulk Assign: ${documentIds.length} documents to agent ${agentId} (pipeline: ${pipeline})`);

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
      throw new Error(`Agent not found: ${agentId}`);
    }

    console.log(`✓ Agent verified: ${agent.name}`);

    // Determine sync function based on pipeline
    const syncFunction = pipeline === 'a' ? 'pipeline-a-sync-agent'
      : pipeline === 'a-hybrid' ? 'pipeline-a-hybrid-sync-agent'
      : pipeline === 'b' ? 'pipeline-b-sync-agent'
      : 'pipeline-c-sync-agent';

    // Return immediate response - processing continues in background
    const response = new Response(
      JSON.stringify({
        success: true,
        message: `Assegnazione di ${documentIds.length} documenti avviata in background`,
        agentId,
        agentName: agent.name,
        documentCount: documentIds.length,
        pipeline,
        syncFunction
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

    // Process ALL documents in background using EdgeRuntime.waitUntil
    // This continues even if client disconnects
    EdgeRuntime.waitUntil((async () => {
      console.log(`📦 Background processing started for ${documentIds.length} documents`);
      
      let successCount = 0;
      let failCount = 0;
      const batchSize = 50; // Process in batches to avoid overwhelming the sync function
      
      // Process in batches
      for (let i = 0; i < documentIds.length; i += batchSize) {
        const batch = documentIds.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} documents`);
        
        try {
          // Call sync function with batch of document IDs
          const { data, error } = await supabase.functions.invoke(syncFunction, {
            body: {
              agentId,
              documentIds: batch
            }
          });

          if (error) {
            console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} error:`, error);
            failCount += batch.length;
          } else {
            console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} success:`, data?.synced || batch.length);
            successCount += data?.synced || batch.length;
          }
        } catch (err) {
          console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} exception:`, err);
          failCount += batch.length;
        }
      }

      console.log(`🏁 Background processing complete: ${successCount} success, ${failCount} failed`);
    })());

    return response;

  } catch (error) {
    console.error('❌ Bulk Assign error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
