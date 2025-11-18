import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, chunkIds } = await req.json();

    if (!agentId || !chunkIds || !Array.isArray(chunkIds)) {
      return new Response(
        JSON.stringify({ error: 'Agent ID and chunk IDs array required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[restore-chunks] Restoring', chunkIds.length, 'chunks for agent:', agentId);

    // Fetch removal history records
    const { data: historyRecords, error: historyError } = await supabase
      .from('knowledge_removal_history')
      .select('*')
      .in('chunk_id', chunkIds)
      .eq('agent_id', agentId)
      .is('restored_at', null);

    if (historyError) {
      console.error('[restore-chunks] History fetch error:', historyError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch removal history' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let restoredCount = 0;
    const errors: Array<{ chunk_id: string; error: string }> = [];

    for (const record of historyRecords || []) {
      try {
        // Check if chunk still exists in agent_knowledge
        const { data: existingChunk } = await supabase
          .from('agent_knowledge')
          .select('id, is_active')
          .eq('id', record.chunk_id)
          .single();

        if (existingChunk) {
          // Chunk exists, just reactivate it
          if (!existingChunk.is_active) {
            const { error: updateError } = await supabase
              .from('agent_knowledge')
              .update({
                is_active: true,
                removed_at: null,
                removal_reason: null,
              })
              .eq('id', record.chunk_id);

            if (updateError) {
              errors.push({ chunk_id: record.chunk_id, error: updateError.message });
              continue;
            }
          }
        } else {
          // Chunk doesn't exist, re-insert from backup
          const { error: insertError } = await supabase
            .from('agent_knowledge')
            .insert({
              id: record.chunk_id,
              agent_id: record.agent_id,
              document_name: record.document_name,
              content: record.content,
              category: record.category,
              summary: record.summary,
              embedding: record.embedding,
              pool_document_id: record.pool_document_id,
              source_type: record.source_type,
              is_active: true,
              removed_at: null,
              removal_reason: null,
            });

          if (insertError) {
            errors.push({ chunk_id: record.chunk_id, error: insertError.message });
            continue;
          }
        }

        // Mark as restored in history
        const { error: historyUpdateError } = await supabase
          .from('knowledge_removal_history')
          .update({
            restored_at: new Date().toISOString(),
            restoration_user_id: agentId, // Could be actual user_id if passed
          })
          .eq('id', record.id);

        if (historyUpdateError) {
          console.error('[restore-chunks] History update error:', historyUpdateError);
        }

        restoredCount++;
        console.log('[restore-chunks] Restored chunk:', record.chunk_id);

      } catch (error: any) {
        console.error('[restore-chunks] Error restoring chunk:', record.chunk_id, error);
        errors.push({ chunk_id: record.chunk_id, error: error.message });
      }
    }

    console.log('[restore-chunks] Restoration complete. Restored:', restoredCount, 'Errors:', errors.length);

    return new Response(
      JSON.stringify({
        success: true,
        restored_count: restoredCount,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[restore-chunks] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
