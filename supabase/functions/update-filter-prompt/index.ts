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
    const { newPromptContent, filterVersion, llmModel, notes, updatedBy } = await req.json();

    console.log('[update-filter-prompt] Request:', { 
      updatedBy, 
      filterVersion,
      llmModel,
      promptLength: newPromptContent?.length 
    });

    // Validate inputs
    if (!newPromptContent) {
      throw new Error('Missing required field: newPromptContent');
    }

    // Validate placeholder presence
    if (!newPromptContent.includes('${agent.system_prompt}')) {
      throw new Error('Filter prompt must contain the placeholder ${agent.system_prompt}');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get current active prompt
    const { data: currentPrompt, error: currentError } = await supabase
      .from('filter_agent_prompts')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (currentError && currentError.code !== 'PGRST116') {
      console.error('[update-filter-prompt] Error fetching current prompt:', currentError);
      throw new Error(`Failed to fetch current prompt: ${currentError.message}`);
    }

    const nextVersionNumber = currentPrompt ? currentPrompt.version_number + 1 : 1;
    const nextFilterVersion = filterVersion || (currentPrompt?.filter_version || 'v6');

    console.log('[update-filter-prompt] Creating version', nextVersionNumber);

    // Deactivate old prompt first
    if (currentPrompt) {
      await supabase
        .from('filter_agent_prompts')
        .update({ is_active: false })
        .eq('id', currentPrompt.id);
    }

    // Insert new prompt version and activate it
    const { data: newPrompt, error: insertError } = await supabase
      .from('filter_agent_prompts')
      .insert({
        version_number: nextVersionNumber,
        prompt_content: newPromptContent,
        is_active: true,
        filter_version: nextFilterVersion,
        llm_model: llmModel || 'google/gemini-2.5-flash',
        notes: notes || null,
        created_by: updatedBy || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[update-filter-prompt] Insert error:', insertError);
      throw new Error(`Failed to save new prompt: ${insertError.message}`);
    }

    console.log('[update-filter-prompt] Successfully created version', nextVersionNumber);

    return new Response(
      JSON.stringify({
        success: true,
        prompt_id: newPrompt.id,
        version_number: nextVersionNumber,
        filter_version: nextFilterVersion,
        message: `Successfully created filter prompt version ${nextVersionNumber}`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error: any) {
    console.error('[update-filter-prompt] Error:', error);
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
