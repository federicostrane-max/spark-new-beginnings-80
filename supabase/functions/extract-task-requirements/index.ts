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
    // Increment this to force re-extraction with updated filters
    const FILTER_VERSION = 'v6';
    
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

    // Check if requirements already exist with same hash and filter version
    
    const { data: existing, error: existingError } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .single();

    // Check active filter version from database
    const { data: activeFilter } = await supabase
      .from('filter_agent_prompts')
      .select('filter_version, version_number')
      .eq('is_active', true)
      .maybeSingle();

    const currentFilterVersion = activeFilter?.filter_version || FILTER_VERSION;
    const expectedModel = `openai/gpt-5-mini-${currentFilterVersion}-prompt_v${activeFilter?.version_number || 1}`;
    
    if (existing && existing.system_prompt_hash === promptHash && existing.extraction_model === expectedModel) {
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
            bibliographic_references: existing.bibliographic_references,
          },
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[extract-task-requirements] Fetching active filter prompt from database');

    // Fetch active filter prompt from database
    const { data: filterPrompt, error: promptError } = await supabase
      .from('filter_agent_prompts')
      .select('prompt_content, filter_version, version_number')
      .eq('is_active', true)
      .maybeSingle();

    let aiPrompt: string;
    let filterVersionForModel: string;

    if (promptError || !filterPrompt) {
      console.warn('[extract-task-requirements] Failed to fetch filter prompt, using hardcoded fallback:', promptError);
      
      // Fallback to hardcoded prompt if database fails
      filterVersionForModel = FILTER_VERSION;
      aiPrompt = `Analyze this AI agent's system prompt and extract its task requirements into a structured format.

System Prompt:
\${agent.system_prompt}

Extract and categorize the following:

1. **Core Concepts**: Key domain concepts, entities, business rules, fundamental knowledge areas
   - Return as array of objects: {concept: string, importance: 'high'|'medium'|'low'}

2. **Procedural Knowledge**: Step-by-step processes, workflows, methodologies the agent needs to follow
   - Return as array of objects: {process: string, steps: string[]}

3. **Decision Patterns**: Decision criteria, prioritization rules, evaluation frameworks
   - Return as array of objects: {pattern: string, criteria: string[]}

4. **Domain Vocabulary**: Extract ONLY terms explicitly mentioned/written in the system prompt text
   - Return as array of strings

5. **Bibliographic References** (CRITICAL PREREQUISITES)
   - Format: array of objects
   - Fields: {type: 'book'|'article'|'author'|'document', title?: string, author?: string, year?: string, importance: 'critical'|'high'|'medium', context: string}

Return ONLY valid JSON in this exact format:
{
  "core_concepts": [{concept: "...", importance: "high"}],
  "procedural_knowledge": [{process: "...", steps: ["...", "..."]}],
  "decision_patterns": [{pattern: "...", criteria: ["...", "..."]}],
  "domain_vocabulary": ["term1", "term2"],
  "bibliographic_references": []
}`;
      // Replace placeholder with actual prompt
      aiPrompt = aiPrompt.replace('${agent.system_prompt}', agent.system_prompt);
    } else {
      console.log(`[extract-task-requirements] Using filter prompt v${filterPrompt.version_number} (${filterPrompt.filter_version})`);
      filterVersionForModel = filterPrompt.filter_version || FILTER_VERSION;
      
      // Replace placeholder in database prompt with actual agent prompt
      aiPrompt = filterPrompt.prompt_content.replace('${agent.system_prompt}', agent.system_prompt);
    }

    console.log('[extract-task-requirements] Calling AI to extract requirements');

    // Call Lovable AI to extract requirements
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

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

    // Filter out generic terms from domain_vocabulary - VERY AGGRESSIVE FILTER
    const GENERIC_TERMS = [
      // Italian generic terms
      'citazione', 'contesto', 'fonte', 'fatto', 'riferimento', 'verifica',
      'estrazione', 'interpretazione', 'limitazione', 'protocollo', 'struttura',
      'infanzia', 'formazione', 'biografia', 'documento', 'informazione',
      'conoscenza', 'base', 'dati', 'sistema', 'processo', 'metodo',
      'analisi', 'valutazione', 'controllo', 'gestione', 'documentazione',
      'posizione', 'interno', 'esterno', 'generale', 'specifico',
      // English generic terms
      'citation', 'context', 'source', 'fact', 'reference', 'verification',
      'extraction', 'interpretation', 'limitation', 'protocol', 'structure',
      'childhood', 'formation', 'biography', 'document', 'information',
      'knowledge', 'base', 'data', 'system', 'process', 'method',
      'analysis', 'evaluation', 'control', 'management', 'documentation',
      'position', 'internal', 'external', 'general', 'specific',
      // Knowledge management terms
      'knowledge base', 'fatto documentato', 'database', 'metadata',
      'chunk', 'embedding', 'vector', 'search', 'query', 'retrieval'
    ];

    if (extracted.domain_vocabulary) {
      const originalCount = extracted.domain_vocabulary.length;
      extracted.domain_vocabulary = extracted.domain_vocabulary.filter(
        (term: string) => {
          const lowerTerm = term.toLowerCase().trim();
          
          // Remove if empty
          if (!lowerTerm) return false;
          
          // Remove if too short (likely generic)
          if (lowerTerm.length < 5) return false;
          
          // Remove if it's a generic term (exact match or contains)
          if (GENERIC_TERMS.some(generic => lowerTerm === generic || lowerTerm.includes(generic))) {
            console.log(`[extract-task-requirements] Filtering out generic term: ${term}`);
            return false;
          }
          
          // Remove if it's all lowercase common words (likely generic)
          const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
          if (commonWords.some(word => lowerTerm === word)) return false;
          
          return true;
        }
      );
      console.log(`[extract-task-requirements] Filtered domain vocabulary: ${originalCount} -> ${extracted.domain_vocabulary.length} terms`);
      console.log(`[extract-task-requirements] Remaining terms:`, extracted.domain_vocabulary);
    }

    // Upsert requirements with filter version to force re-extraction when filter changes
    const { data: requirement, error: upsertError } = await supabase
      .from('agent_task_requirements')
      .upsert({
        agent_id: agentId,
        core_concepts: extracted.core_concepts || [],
        procedural_knowledge: extracted.procedural_knowledge || [],
        decision_patterns: extracted.decision_patterns || [],
        domain_vocabulary: extracted.domain_vocabulary || [],
        bibliographic_references: extracted.bibliographic_references || [],
        extraction_model: `openai/gpt-5-mini-${filterVersionForModel}-prompt_v${filterPrompt?.version_number || 1}`,
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