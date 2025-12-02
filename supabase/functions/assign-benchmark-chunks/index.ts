import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Benchmark agent ID (Pipeline C tester)
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

    // Parse optional documentId for event-driven mode
    const { documentId } = await req.json().catch(() => ({}));

    // ====== EVENT-DRIVEN MODE ======
    // When documentId is provided, process only that specific document
    if (documentId) {
      console.log(`[Assign Benchmark Chunks] 🎯 Event-Driven mode: Processing document ${documentId}`);

      // Verify document is in benchmark_datasets
      const { data: benchmarkRecord, error: benchmarkError } = await supabase
        .from('benchmark_datasets')
        .select('id, file_name, suite_category')
        .eq('document_id', documentId)
        .maybeSingle();

      if (benchmarkError) {
        console.error('[Assign Benchmark Chunks] Error checking benchmark_datasets:', benchmarkError);
        return new Response(
          JSON.stringify({ error: benchmarkError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!benchmarkRecord) {
        console.log(`[Assign Benchmark Chunks] ⚠️ Document ${documentId} not in benchmark_datasets, skipping`);
        return new Response(
          JSON.stringify({ success: true, mode: 'event-driven', assigned: 0, message: 'Not a benchmark document' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch all ready chunks for this specific document
      const { data: chunks, error: fetchError } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id')
        .eq('document_id', documentId)
        .eq('embedding_status', 'ready');

      if (fetchError) {
        console.error('[Assign Benchmark Chunks] Error fetching chunks:', fetchError);
        return new Response(
          JSON.stringify({ error: fetchError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!chunks || chunks.length === 0) {
        console.log(`[Assign Benchmark Chunks] ⚠️ No ready chunks found for ${benchmarkRecord.file_name}`);
        return new Response(
          JSON.stringify({ success: true, mode: 'event-driven', assigned: 0, message: 'No ready chunks' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Assign chunks to benchmark agent
      const assignments = chunks.map((c: any) => ({
        agent_id: BENCHMARK_AGENT_ID,
        chunk_id: c.id,
        is_active: true
      }));

      const { error: upsertError } = await supabase
        .from('pipeline_a_hybrid_agent_knowledge')
        .upsert(assignments, { onConflict: 'agent_id,chunk_id' });

      if (upsertError) {
        console.error(`[Assign Benchmark Chunks] ❌ Failed to assign chunks for ${benchmarkRecord.file_name}:`, upsertError);
        return new Response(
          JSON.stringify({ error: upsertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[Assign Benchmark Chunks] ✅ Event-Driven: Assigned ${chunks.length} chunks for ${benchmarkRecord.file_name} (suite: ${benchmarkRecord.suite_category})`);

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'event-driven',
          assigned: chunks.length,
          file_name: benchmarkRecord.file_name,
          suite_category: benchmarkRecord.suite_category
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ====== CRON FALLBACK MODE ======
    // When no documentId is provided, scan for all unassigned benchmark documents
    console.log('[Assign Benchmark Chunks] 🔍 Cron fallback mode: Checking for unassigned benchmark documents...');

    // Get all unassigned benchmark documents using RPC
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
        JSON.stringify({ success: true, mode: 'cron', assigned: 0, message: 'No unassigned documents' }),
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

    console.log(`[Assign Benchmark Chunks] 🎉 Cron complete: ${totalAssigned} chunks across ${unassignedDocs.length} documents`);

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'cron',
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
