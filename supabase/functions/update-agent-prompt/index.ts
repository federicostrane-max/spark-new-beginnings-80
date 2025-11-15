import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

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
    const { agentSlugOrId, newSystemPrompt, updatedBy } = await req.json();

    console.log('[update-agent-prompt] Request:', { agentSlugOrId, updatedBy, promptLength: newSystemPrompt?.length });

    // Validate inputs
    if (!agentSlugOrId || !newSystemPrompt) {
      throw new Error('Missing required fields: agentSlugOrId and newSystemPrompt are required');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find the agent by slug or id
    let query = supabase
      .from('agents')
      .select('id, name, slug, system_prompt');

    // Check if it's a UUID (id) or slug
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentSlugOrId);
    
    if (isUuid) {
      query = query.eq('id', agentSlugOrId);
    } else {
      query = query.eq('slug', agentSlugOrId);
    }

    const { data: agents, error: findError } = await query;

    if (findError) {
      console.error('[update-agent-prompt] Error finding agent:', findError);
      throw new Error(`Failed to find agent: ${findError.message}`);
    }

    if (!agents || agents.length === 0) {
      throw new Error(`Agent not found with ${isUuid ? 'id' : 'slug'}: ${agentSlugOrId}`);
    }

    const agent = agents[0];
    const oldPrompt = agent.system_prompt;

    console.log('[update-agent-prompt] Found agent:', { id: agent.id, name: agent.name, slug: agent.slug });

    // Get current version number from history
    const { data: historyData, error: historyError } = await supabase
      .from('agent_prompt_history')
      .select('version_number')
      .eq('agent_id', agent.id)
      .order('version_number', { ascending: false })
      .limit(1);

    if (historyError) {
      console.error('[update-agent-prompt] Error fetching history:', historyError);
    }

    const nextVersionNumber = (historyData && historyData.length > 0) 
      ? historyData[0].version_number + 1 
      : 1;

    console.log('[update-agent-prompt] Next version number:', nextVersionNumber);

    // Save old prompt to history before updating
    if (oldPrompt) {
      const oldVersionNumber = nextVersionNumber - 1 > 0 ? nextVersionNumber - 1 : 1;
      console.log('[update-agent-prompt] Saving old prompt to history (version:', oldVersionNumber, ')');
      
      const { data: oldHistoryData, error: historyInsertError } = await supabase
        .from('agent_prompt_history')
        .insert({
          agent_id: agent.id,
          system_prompt: oldPrompt,
          version_number: oldVersionNumber,
          created_by: updatedBy || null
        })
        .select();

      if (historyInsertError) {
        console.error('[update-agent-prompt] ❌ CRITICAL: Failed to save old prompt to history:', historyInsertError);
        throw new Error(`Failed to save old prompt to history: ${historyInsertError.message}`);
      }
      
      console.log('[update-agent-prompt] ✅ Old prompt saved to history:', oldHistoryData);
    } else {
      console.log('[update-agent-prompt] ⚠️ No old prompt to save (first version)');
    }

    // Update the agent's system prompt
    console.log('[update-agent-prompt] Updating agent system prompt...');
    const { data: updateData, error: updateError } = await supabase
      .from('agents')
      .update({ 
        system_prompt: newSystemPrompt
      })
      .eq('id', agent.id)
      .select();

    if (updateError) {
      console.error('[update-agent-prompt] ❌ CRITICAL: Failed to update agent:', updateError);
      throw new Error(`Failed to update agent prompt: ${updateError.message}`);
    }
    
    if (!updateData || updateData.length === 0) {
      console.error('[update-agent-prompt] ❌ CRITICAL: No agent was updated');
      throw new Error('Agent update returned no data - agent may not exist');
    }
    
    console.log('[update-agent-prompt] ✅ Agent prompt updated successfully');

    // Save new prompt to history
    console.log('[update-agent-prompt] Saving new prompt to history (version:', nextVersionNumber, ')');
    const { data: newHistoryData, error: newHistoryError } = await supabase
      .from('agent_prompt_history')
      .insert({
        agent_id: agent.id,
        system_prompt: newSystemPrompt,
        version_number: nextVersionNumber,
        created_by: updatedBy || null
      })
      .select();

    if (newHistoryError) {
      console.error('[update-agent-prompt] ❌ CRITICAL: Failed to save new version to history:', newHistoryError);
      // Rollback the agent update
      await supabase
        .from('agents')
        .update({ system_prompt: oldPrompt })
        .eq('id', agent.id);
      throw new Error(`Failed to save new version to history: ${newHistoryError.message}`);
    }
    
    if (!newHistoryData || newHistoryData.length === 0) {
      console.error('[update-agent-prompt] ❌ CRITICAL: History insert returned no data');
      // Rollback the agent update
      await supabase
        .from('agents')
        .update({ system_prompt: oldPrompt })
        .eq('id', agent.id);
      throw new Error('History insert returned no data');
    }
    
    console.log('[update-agent-prompt] ✅ New prompt saved to history:', newHistoryData);

    console.log('[update-agent-prompt] Successfully updated agent prompt');

    return new Response(
      JSON.stringify({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          slug: agent.slug
        },
        versionNumber: nextVersionNumber,
        message: `Successfully updated system prompt for agent "${agent.name}" (version ${nextVersionNumber})`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error: any) {
    console.error('[update-agent-prompt] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message || 'Unknown error occurred'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});
