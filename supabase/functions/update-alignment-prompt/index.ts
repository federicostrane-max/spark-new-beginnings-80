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
    const { newPromptContent, alignmentVersion, llmModel, notes, updatedBy, agentType } = await req.json();

    console.log('[update-alignment-prompt] Request:', { 
      updatedBy, 
      alignmentVersion,
      llmModel,
      promptLength: newPromptContent?.length 
    });

    // Validate inputs
    if (!newPromptContent) {
      throw new Error('Missing required field: newPromptContent');
    }

    // Validate placeholder presence (different from filter!)
    const requiredPlaceholders = ['${requirements.', '${chunk.'];
    const missing = requiredPlaceholders.filter(p => !newPromptContent.includes(p));
    
    if (missing.length > 0) {
      throw new Error(`Alignment prompt must contain placeholders: ${missing.join(', ')}`);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get current active prompt for this specific agent type
    const targetAgentType = agentType || 'general';
    const { data: currentPrompt, error: currentError } = await supabase
      .from('alignment_agent_prompts')
      .select('*')
      .eq('is_active', true)
      .eq('agent_type', targetAgentType)
      .maybeSingle();

    if (currentError && currentError.code !== 'PGRST116') {
      console.error('[update-alignment-prompt] Error fetching current prompt:', currentError);
      throw new Error(`Failed to fetch current prompt: ${currentError.message}`);
    }

    const nextVersionNumber = currentPrompt ? currentPrompt.version_number + 1 : 1;
    const nextAlignmentVersion = alignmentVersion || (currentPrompt?.alignment_version || 'v1');

    console.log('[update-alignment-prompt] Creating version', nextVersionNumber);

    // Deactivate all prompts for this agent type
    await supabase
      .from('alignment_agent_prompts')
      .update({ is_active: false })
      .eq('agent_type', targetAgentType);

    // Insert new prompt version and activate it
    const { data: newPrompt, error: insertError } = await supabase
      .from('alignment_agent_prompts')
      .insert({
        agent_type: targetAgentType,
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
      console.error('[update-alignment-prompt] Insert error:', insertError);
      throw new Error(`Failed to save new prompt: ${insertError.message}`);
    }

    console.log('[update-alignment-prompt] Successfully created version', nextVersionNumber);

    return new Response(
      JSON.stringify({
        success: true,
        prompt_id: newPrompt.id,
        version_number: nextVersionNumber,
        alignment_version: nextAlignmentVersion,
        message: `Successfully created alignment prompt version ${nextVersionNumber}`
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
