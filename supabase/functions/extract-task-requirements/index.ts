import "https://deno.land/x/xhr@0.1.0/mod.ts";
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

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: 'Agent ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[extract-task-requirements] Fetching agent:', agentId);

    // Fetch agent with system_prompt
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, name, system_prompt')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      console.error('[extract-task-requirements] Agent fetch error:', agentError);
      return new Response(
        JSON.stringify({ error: 'Agent not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate hash of system_prompt
    const encoder = new TextEncoder();
    const data = encoder.encode(agent.system_prompt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const promptHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    console.log('[extract-task-requirements] Prompt hash:', promptHash);

    // Check if requirements already exist with same hash
    const { data: existing, error: existingError } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    if (existing && existing.system_prompt_hash === promptHash) {
      console.log('[extract-task-requirements] Requirements up to date');
      return new Response(
        JSON.stringify({
          success: true,
          requirement_id: existing.id,
          extracted: {
            core_concepts: existing.core_concepts,
            procedural_knowledge: existing.procedural_knowledge,
            decision_patterns: existing.decision_patterns,
            domain_vocabulary: existing.domain_vocabulary,
          },
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[extract-task-requirements] Calling AI to extract requirements');

    // Call Lovable AI to extract requirements
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

    const aiPrompt = `Analyze this AI agent's system prompt and extract its task requirements into a structured format.

System Prompt:
${agent.system_prompt}

Extract and categorize the following:

1. **Core Concepts**: Key domain concepts, entities, business rules, fundamental knowledge areas
   - Return as array of objects: {concept: string, importance: 'high'|'medium'|'low'}

2. **Procedural Knowledge**: Step-by-step processes, workflows, methodologies the agent needs to follow
   - Return as array of objects: {process: string, steps: string[]}

3. **Decision Patterns**: Decision criteria, prioritization rules, evaluation frameworks
   - Return as array of objects: {pattern: string, criteria: string[]}

4. **Domain Vocabulary**: ONLY domain-specific terms, proper nouns, specialized terminology unique to this agent's subject area
   - INCLUDE ONLY: Names of people, places, events, organizations, specialized technical terms, domain-specific jargon
   - EXCLUDE ALL: Generic terms that any LLM already knows (e.g., "context", "citation", "fact", "knowledge base", "source", "reference", "methodology", "protocol", "structure")
   - EXCLUDE ALL: Common words and general concepts
   - EXCLUDE ALL: Meta-terms about knowledge management or information processing
   - Focus ONLY on terms that would require specialized knowledge to understand
   - Return as array of strings
   
   Example for a biography agent about Che Guevara:
   - CORRECT: ["Sierra Maestra", "La Higuera", "Revolución Cubana", "Foco guerrillero", "Ejército Rebelde", "Movimento 26 de Julio"]
   - WRONG: ["citazione", "contesto", "fonte", "biografia", "documento", "knowledge base", "fatto documentato", "protocollo"]

Return ONLY valid JSON in this exact format:
{
  "core_concepts": [{concept: "...", importance: "high"}],
  "procedural_knowledge": [{process: "...", steps: ["...", "..."]}],
  "decision_patterns": [{pattern: "...", criteria: ["...", "..."]}],
  "domain_vocabulary": ["term1", "term2"]
}`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5-mini',
        messages: [
          { role: 'system', content: 'You are an expert at analyzing AI system prompts and extracting structured task requirements. Return only valid JSON.' },
          { role: 'user', content: aiPrompt }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[extract-task-requirements] AI API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'AI extraction failed', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices[0].message.content;

    console.log('[extract-task-requirements] AI response received');

    // Parse JSON response
    let extracted;
    try {
      extracted = JSON.parse(content);
    } catch (parseError) {
      console.error('[extract-task-requirements] JSON parse error:', parseError);
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[1]);
      } else {
        return new Response(
          JSON.stringify({ error: 'Failed to parse AI response', details: content }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Filter out generic terms from domain_vocabulary
    const GENERIC_TERMS = [
      'citazione', 'contesto', 'fonte', 'knowledge base', 'fatto documentato',
      'posizione riferimento', 'verifica interna', 'estrazione', 'interpretazione',
      'limitazione', 'protocollo', 'struttura', 'infanzia', 'formazione',
      'citation', 'context', 'source', 'fact', 'reference', 'verification',
      'extraction', 'interpretation', 'limitation', 'protocol', 'structure',
      'biography', 'biografia', 'document', 'documento', 'information', 'informazione'
    ];

    if (extracted.domain_vocabulary) {
      const originalCount = extracted.domain_vocabulary.length;
      extracted.domain_vocabulary = extracted.domain_vocabulary.filter(
        (term: string) => {
          const lowerTerm = term.toLowerCase();
          // Remove if it's a generic term
          if (GENERIC_TERMS.some(generic => lowerTerm.includes(generic))) {
            return false;
          }
          // Remove if it's too short (likely generic)
          if (term.length < 4) {
            return false;
          }
          return true;
        }
      );
      console.log(`[extract-task-requirements] Filtered domain vocabulary: ${originalCount} -> ${extracted.domain_vocabulary.length} terms`);
    }

    // Upsert requirements
    const { data: requirement, error: upsertError } = await supabase
      .from('agent_task_requirements')
      .upsert({
        agent_id: agentId,
        core_concepts: extracted.core_concepts || [],
        procedural_knowledge: extracted.procedural_knowledge || [],
        decision_patterns: extracted.decision_patterns || [],
        domain_vocabulary: extracted.domain_vocabulary || [],
        extraction_model: 'openai/gpt-5-mini',
        system_prompt_hash: promptHash,
        extracted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'agent_id',
      })
      .select()
      .single();

    if (upsertError) {
      console.error('[extract-task-requirements] Upsert error:', upsertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save requirements', details: upsertError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[extract-task-requirements] Requirements saved:', requirement.id);

    return new Response(
      JSON.stringify({
        success: true,
        requirement_id: requirement.id,
        extracted,
        cached: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[extract-task-requirements] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
