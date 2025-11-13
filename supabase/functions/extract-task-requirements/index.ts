import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId } = await req.json();
    
    console.log('[extract-task-requirements] Starting extraction for agent:', agentId);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Fetch agent
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('system_prompt, name')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      throw new Error(`Agent not found: ${agentError?.message}`);
    }

    console.log('[extract-task-requirements] Agent found:', agent.name);

    // 2. Calculate prompt hash
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(agent.system_prompt));
    const promptHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // 3. Check cache
    const { data: existing } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .eq('system_prompt_hash', promptHash)
      .maybeSingle();

    if (existing) {
      console.log('[extract-task-requirements] Using cached requirements');
      return new Response(
        JSON.stringify({ success: true, cached: true, requirement_id: existing.id, data: existing }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Fetch active filter prompt
    const { data: filterPrompt, error: filterError } = await supabase
      .from('filter_agent_prompts')
      .select('prompt_content, filter_version')
      .eq('is_active', true)
      .single();

    if (filterError || !filterPrompt) {
      throw new Error('No active filter prompt found');
    }

    console.log('[extract-task-requirements] Using filter prompt version:', filterPrompt.filter_version);

    // 5. Prepare AI prompt
    const aiPrompt = `${filterPrompt.prompt_content}

AGENT SYSTEM PROMPT TO ANALYZE:
${agent.system_prompt}`;

    // 6. Call AI with filter prompt
    console.log('[extract-task-requirements] Calling AI for extraction...');
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'user', content: aiPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API error: ${response.status} - ${errorText}`);
    }

    const aiData = await response.json();
    const content = aiData.choices[0].message.content;

    // 7. Parse JSON (supporta sia raw JSON che markdown ```json)
    let extracted;
    try {
      extracted = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Invalid AI response format - not valid JSON');
      }
    }

    // 8. Validate structure
    const requiredFields = [
      'theoretical_concepts',
      'operational_concepts',
      'procedural_knowledge',
      'explicit_rules',
      'domain_vocabulary',
      'bibliographic_references'
    ];

    for (const field of requiredFields) {
      if (!Array.isArray(extracted[field])) {
        throw new Error(`Missing or invalid field: ${field}`);
      }
    }

    console.log('[extract-task-requirements] Extraction successful:', {
      theoretical_concepts: extracted.theoretical_concepts.length,
      operational_concepts: extracted.operational_concepts.length,
      procedural_knowledge: extracted.procedural_knowledge.length,
      explicit_rules: extracted.explicit_rules.length,
      domain_vocabulary: extracted.domain_vocabulary.length,
      bibliographic_references: extracted.bibliographic_references.length
    });

    // 9. Save to database
    const { data: requirement, error: insertError } = await supabase
      .from('agent_task_requirements')
      .upsert({
        agent_id: agentId,
        theoretical_concepts: extracted.theoretical_concepts,
        operational_concepts: extracted.operational_concepts,
        procedural_knowledge: extracted.procedural_knowledge,
        explicit_rules: extracted.explicit_rules,
        domain_vocabulary: extracted.domain_vocabulary,
        bibliographic_references: extracted.bibliographic_references,
        extraction_model: `openai/gpt-5-mini-${filterPrompt.filter_version}`,
        system_prompt_hash: promptHash,
      }, { onConflict: 'agent_id' })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to save requirements: ${insertError.message}`);
    }

    console.log('[extract-task-requirements] Requirements saved successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        cached: false, 
        requirement_id: requirement.id,
        data: extracted 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-task-requirements] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
