import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { newPromptContent, alignmentVersion, llmModel, notes, updatedBy, agentType, globalLlmUpdate } = await req.json();

    console.log('[update-alignment-prompt] Request:', { 
      updatedBy, 
      alignmentVersion,
      llmModel,
      promptLength: newPromptContent?.length,
      agentType: agentType || 'ALL TYPES',
      globalLlmUpdate: globalLlmUpdate || false
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // SPECIAL CASE: Global LLM Update Only
    // When globalLlmUpdate=true, we ONLY update the llm_model field for all types
    // This preserves each type's unique prompt_content
    if (globalLlmUpdate && llmModel) {
      const allAgentTypes = ['general', 'procedural', 'narrative', 'technical', 'research', 'domain-expert'];
      
      console.log('[update-alignment-prompt] Global LLM update mode - updating all types to:', llmModel);
      
      const updateResults = [];
      for (const type of allAgentTypes) {
        const { error: updateError } = await supabase
          .from('alignment_agent_prompts')
          .update({ llm_model: llmModel })
          .eq('agent_type', type)
          .eq('is_active', true);
        
        if (updateError) {
          console.error(`[update-alignment-prompt] Failed to update ${type}:`, updateError);
          throw new Error(`Failed to update ${type}: ${updateError.message}`);
        }
        
        updateResults.push(type);
        console.log(`[update-alignment-prompt] Updated ${type} to ${llmModel}`);
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          types_updated: updateResults.length,
          model: llmModel,
          message: `Successfully updated LLM model to ${llmModel} for all ${updateResults.length} agent types`
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      );
    }

    // NORMAL CASE: Validate prompt content for new version creation
    if (!newPromptContent) {
      throw new Error('Missing required field: newPromptContent');
    }

    // Validate placeholder presence (different from filter!)
    const requiredPlaceholders = ['${requirements.', '${chunk.'];
    const missing = requiredPlaceholders.filter(p => !newPromptContent.includes(p));
    
    if (missing.length > 0) {
      throw new Error(`Alignment prompt must contain placeholders: ${missing.join(', ')}`);
    }

    // Determine which agent types to update
    const agentTypes = agentType 
      ? [agentType] 
      : ['general', 'procedural', 'narrative', 'technical', 'research', 'domain-expert'];

    console.log('[update-alignment-prompt] Updating agent types:', agentTypes);

    const results = [];

    // Update each agent type
    for (const type of agentTypes) {
      console.log(`[update-alignment-prompt] Processing type: ${type}`);

      // Get current active prompt for this type
      const { data: currentPrompt, error: currentError } = await supabase
        .from('alignment_agent_prompts')
        .select('*')
        .eq('is_active', true)
        .eq('agent_type', type)
        .maybeSingle();

      if (currentError && currentError.code !== 'PGRST116') {
        console.error(`[update-alignment-prompt] Error fetching prompt for ${type}:`, currentError);
        throw new Error(`Failed to fetch current prompt for ${type}: ${currentError.message}`);
      }

      const nextVersionNumber = currentPrompt ? currentPrompt.version_number + 1 : 1;
      const nextAlignmentVersion = alignmentVersion || (currentPrompt?.alignment_version || 'v1');

      // Deactivate all prompts for this agent type
      const { error: deactivateError } = await supabase
        .from('alignment_agent_prompts')
        .update({ is_active: false })
        .eq('agent_type', type)
        .eq('is_active', true);

      if (deactivateError) {
        console.error(`[update-alignment-prompt] Deactivate error for ${type}:`, deactivateError);
        throw new Error(`Failed to deactivate prompts for ${type}: ${deactivateError.message}`);
      }

      console.log(`[update-alignment-prompt] Deactivated existing prompts for ${type}`);

      // Insert new prompt version
      const { data: newPrompt, error: insertError } = await supabase
        .from('alignment_agent_prompts')
        .insert({
          agent_type: type,
          version_number: nextVersionNumber,
          prompt_content: newPromptContent,
          is_active: true,
          alignment_version: nextAlignmentVersion,
          llm_model: llmModel || 'google/gemini-2.5-flash',
          notes: notes || null,
          created_by: updatedBy || null,
        })
        .select()
        .single();

      if (insertError) {
        console.error(`[update-alignment-prompt] Insert error for ${type}:`, insertError);
        throw new Error(`Failed to save prompt for ${type}: ${insertError.message}`);
      }

      console.log(`[update-alignment-prompt] Successfully created version ${nextVersionNumber} for ${type}`);
      
      results.push({
        agent_type: type,
        version_number: nextVersionNumber,
        prompt_id: newPrompt.id
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        results,
        types_updated: agentTypes.length,
        message: agentTypes.length === 1 
          ? `Successfully created alignment prompt version for ${agentTypes[0]}`
          : `Successfully updated alignment prompts for all ${agentTypes.length} agent types`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error: any) {
    console.error('[update-alignment-prompt] Error:', error);
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
