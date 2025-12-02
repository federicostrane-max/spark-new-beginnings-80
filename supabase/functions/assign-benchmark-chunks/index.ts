import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Benchmark agent ID (pipiline C tester)
const BENCHMARK_AGENT_ID = 'bcca9289-0d7b-4e74-87f5-0f66ae93249c';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[Assign Benchmark Chunks] 🔍 Checking for unassigned benchmark documents...');

    // Get all unassigned benchmark documents
    const { data: unassignedDocs, error: rpcError } = await supabase
      .rpc('get_unassigned_benchmark_documents');

    if (rpcError) {
      console.error('[Assign Benchmark Chunks] RPC error:', rpcError);
      return new Response(
        JSON.stringify({ error: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!unassignedDocs || unassignedDocs.length === 0) {
      console.log('[Assign Benchmark Chunks] ✅ No unassigned documents found');
      return new Response(
        JSON.stringify({ success: true, assigned: 0, message: 'No unassigned documents' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Assign Benchmark Chunks] 📋 Found ${unassignedDocs.length} documents with unassigned chunks`);

    let totalAssigned = 0;
    const results = [];

    for (const doc of unassignedDocs) {
      console.log(`[Assign Benchmark Chunks] Processing document: ${doc.file_name} (${doc.ready_chunks} ready chunks)`);

      // Fetch all ready chunk IDs for this document
      const { data: chunks, error: fetchError } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id')
        .eq('document_id', doc.document_id)
        .eq('embedding_status', 'ready');

      if (fetchError || !chunks?.length) {
        console.warn(`[Assign Benchmark Chunks] ⚠️ No ready chunks found for ${doc.file_name}`);
        results.push({ file_name: doc.file_name, assigned: 0, error: 'No ready chunks' });
        continue;
      }

      // Insert into pipeline_a_hybrid_agent_knowledge
      const assignments = chunks.map((c: any) => ({
        agent_id: BENCHMARK_AGENT_ID,
        chunk_id: c.id,
        is_active: true
      }));

      const { error: upsertError } = await supabase
        .from('pipeline_a_hybrid_agent_knowledge')
        .upsert(assignments, { onConflict: 'agent_id,chunk_id' });

      if (upsertError) {
        console.error(`[Assign Benchmark Chunks] ❌ Failed to assign chunks for ${doc.file_name}:`, upsertError);
        results.push({ file_name: doc.file_name, assigned: 0, error: upsertError.message });
        continue;
      }

      console.log(`[Assign Benchmark Chunks] ✅ Assigned ${chunks.length} chunks for ${doc.file_name}`);
      totalAssigned += chunks.length;
      results.push({ file_name: doc.file_name, assigned: chunks.length });
    }

    console.log(`[Assign Benchmark Chunks] 🎉 Total assigned: ${totalAssigned} chunks across ${unassignedDocs.length} documents`);

    return new Response(
      JSON.stringify({
        success: true,
        documentsProcessed: unassignedDocs.length,
        totalAssigned,
        results
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Assign Benchmark Chunks] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
