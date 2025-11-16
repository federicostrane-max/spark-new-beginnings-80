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

    // 3. Fetch active filter prompt (BEFORE cache check)
    const { data: filterPrompt, error: filterError } = await supabase
      .from('filter_agent_prompts')
      .select('id, prompt_content, filter_version, llm_model')
      .eq('is_active', true)
      .single();

    if (filterError || !filterPrompt) {
      throw new Error('No active filter prompt found');
    }

    const llmModel = filterPrompt.llm_model || 'google/gemini-2.5-flash';
    console.log('[extract-task-requirements] Using filter prompt ID:', filterPrompt.id);
    console.log('[extract-task-requirements] Using filter prompt version:', filterPrompt.filter_version);
    console.log('[extract-task-requirements] Using LLM model:', llmModel);

    // 4. Check cache using filter_prompt_id for proper version tracking
    const { data: existing } = await supabase
      .from('agent_task_requirements')
      .select('*')
      .eq('agent_id', agentId)
      .eq('system_prompt_hash', promptHash)
      .eq('extraction_model', llmModel)
      .eq('filter_prompt_id', filterPrompt.id)
      .maybeSingle();

    if (existing) {
      console.log('[extract-task-requirements] Cache lookup:', {
        agent_id: agentId,
        system_prompt_hash: promptHash.substring(0, 8) + '...',
        filter_prompt_id: filterPrompt.id,
        llm_model: llmModel,
        filter_version: filterPrompt.filter_version,
        found_cache: true
      });
      console.log('[extract-task-requirements] Using cached requirements for filter prompt ID:', filterPrompt.id);
      return new Response(
        JSON.stringify({ success: true, cached: true, requirement_id: existing.id, data: existing }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[extract-task-requirements] Cache lookup:', {
      agent_id: agentId,
      system_prompt_hash: promptHash.substring(0, 8) + '...',
      filter_prompt_id: filterPrompt.id,
      llm_model: llmModel,
      filter_version: filterPrompt.filter_version,
      found_cache: false
    });

    // 5. Prepare AI prompt
    const aiPrompt = `${filterPrompt.prompt_content}

AGENT SYSTEM PROMPT TO ANALYZE:
${agent.system_prompt}`;

    // 6. Call AI with filter prompt
    console.log('[extract-task-requirements] Calling AI for extraction...');
    
    let response;
    
    // Define the tool schema for structured extraction (only for supported models)
    const extractionTool = {
      type: "function",
      function: {
        name: "extract_requirements",
        description: "Extract structured task requirements from an agent system prompt",
        parameters: {
          type: "object",
          properties: {
            theoretical_concepts: {
              type: "array",
              items: { type: "string" },
              description: "Theoretical concepts from the prompt"
            },
            operational_concepts: {
              type: "array",
              items: { type: "string" },
              description: "Operational concepts from the prompt"
            },
            procedural_knowledge: {
              type: "array",
              items: { type: "string" },
              description: "Procedural knowledge from the prompt"
            },
            explicit_rules: {
              type: "array",
              items: { type: "string" },
              description: "Explicit rules from the prompt"
            },
            domain_vocabulary: {
              type: "array",
              items: { type: "string" },
              description: "Domain-specific vocabulary"
            },
            bibliographic_references: {
              type: "object",
              description: "Bibliographic references as key-value pairs where each key is 'ref_X' and value contains title, authors, type, importance, version_specific, and abbreviation. Example: { 'ref_theory': { 'title': 'Theory Manual', 'authors': ['Author'], 'type': 'manual', 'importance': 'critical', 'version_specific': false, 'abbreviation': '[THEORY]' } }",
              additionalProperties: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  authors: { type: "array", items: { type: "string" } },
                  type: { type: "string", enum: ["manual", "tutorial", "article", "book", "documentation"] },
                  importance: { type: "string", enum: ["critical", "supporting"] },
                  version_specific: { type: "boolean" },
                  abbreviation: { type: "string", pattern: "^\\[.+\\]$" }
                },
                required: ["title", "authors", "type", "importance", "version_specific", "abbreviation"]
              }
            }
          },
          required: ["theoretical_concepts", "operational_concepts", "procedural_knowledge", "explicit_rules", "domain_vocabulary", "bibliographic_references"],
          additionalProperties: false
        }
      }
    };

    // Determine which API to use based on model
    // Note: deepseek-reasoner doesn't support tool calling, so we need to use text for it
    const isReasonerModel = llmModel === 'deepseek/deepseek-reasoner';
    
    if (llmModel.startsWith('deepseek/')) {
      // DeepSeek API
      const deepseekModel = llmModel.replace('deepseek/', '');
      const requestBody: any = {
        model: deepseekModel,
        messages: [{ role: 'user', content: aiPrompt }],
      };
      
      // Only add tool calling for non-reasoner models
      if (!isReasonerModel) {
        requestBody.tools = [extractionTool];
        requestBody.tool_choice = { type: "function", function: { name: "extract_requirements" } };
      } else {
        // For reasoner, explicitly request JSON in the prompt
        requestBody.messages[0].content += '\n\nYou MUST respond with ONLY a valid JSON object in this exact format, with no additional text:\n```json\n{\n  "theoretical_concepts": [...],\n  "operational_concepts": [...],\n  "procedural_knowledge": [...],\n  "explicit_rules": [...],\n  "domain_vocabulary": [...],\n  "bibliographic_references": {...}\n}\n```';
      }
      
      response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('DEEPSEEK_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
    } else if (llmModel.startsWith('claude-')) {
      // Anthropic API with tool calling
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: llmModel,
          max_tokens: 4096,
          messages: [{ role: 'user', content: aiPrompt }],
          tools: [{
            name: "extract_requirements",
            description: "Extract structured task requirements from an agent system prompt",
            input_schema: extractionTool.function.parameters
          }],
          tool_choice: { type: "tool", name: "extract_requirements" }
        }),
      });
    } else {
      // Lovable AI Gateway (default for google/openai models) with tool calling
      response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: llmModel,
          messages: [{ role: 'user', content: aiPrompt }],
          tools: [extractionTool],
          tool_choice: { type: "function", function: { name: "extract_requirements" } }
        }),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API error: ${response.status} - ${errorText}`);
    }

    const aiData = await response.json();
    
    // Extract tool call results based on API response format
    let extracted;
    
    if (isReasonerModel) {
      // DeepSeek Reasoner returns text, not tool calls - parse it
      const content = aiData.choices[0].message.content;
      console.log('[extract-task-requirements] Raw reasoner response length:', content.length);
      console.log('[extract-task-requirements] First 500 chars:', content.substring(0, 500));
      
      // Try extracting JSON from markdown code block
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[1]);
        console.log('[extract-task-requirements] Extracted from JSON code block');
      } else {
        // Try direct JSON parse
        try {
          extracted = JSON.parse(content);
          console.log('[extract-task-requirements] Extracted from direct JSON');
        } catch {
          // Last resort: try to find JSON object in the text
          const jsonObjectMatch = content.match(/\{[\s\S]*"theoretical_concepts"[\s\S]*\}/);
          if (jsonObjectMatch) {
            extracted = JSON.parse(jsonObjectMatch[0]);
            console.log('[extract-task-requirements] Extracted from found JSON object');
          } else {
            console.error('[extract-task-requirements] Failed to find JSON. Content:', content.substring(0, 1000));
            throw new Error('Could not extract JSON from reasoner response');
          }
        }
      }
    } else if (llmModel.startsWith('claude-')) {
      // Anthropic format: { content: [{ type: "tool_use", input: {...} }] }
      const toolUse = aiData.content.find((c: any) => c.type === 'tool_use');
      if (!toolUse) {
        throw new Error('No tool call found in Anthropic response');
      }
      extracted = toolUse.input;
      console.log('[extract-task-requirements] Extracted from Anthropic tool call');
    } else {
      // OpenAI/DeepSeek format: { choices: [{ message: { tool_calls: [{function: {arguments: "..."}}] } }] }
      const message = aiData.choices[0].message;
      if (!message.tool_calls || message.tool_calls.length === 0) {
        throw new Error('No tool calls found in response');
      }
      const toolCall = message.tool_calls[0];
      extracted = JSON.parse(toolCall.function.arguments);
      console.log('[extract-task-requirements] Extracted from tool call');
    }
    
    console.log('[extract-task-requirements] Successfully parsed JSON structure');

    // 7.5 Transform bibliographic_references if in incorrect format
    if (extracted.bibliographic_references) {
      const bibRefs = extracted.bibliographic_references;
      
      // Check if it has incorrect structure (primary_sources array or other custom keys)
      if (Array.isArray(bibRefs.primary_sources)) {
        console.log('[extract-task-requirements] Detected incorrect bibliographic_references structure, transforming...');
        const transformedRefs: any = {};
        
        bibRefs.primary_sources.forEach((source: any, index: number) => {
          const refKey = `ref_${index + 1}`;
          transformedRefs[refKey] = {
            title: source.title || source.name || 'Unknown',
            authors: source.authors || source.author ? [source.author] : [],
            type: source.type || 'documentation',
            importance: source.importance || 'supporting',
            version_specific: source.version_specific !== undefined ? source.version_specific : false,
            abbreviation: source.abbreviation || source.tag || `[REF${index + 1}]`
          };
        });
        
        extracted.bibliographic_references = transformedRefs;
        console.log('[extract-task-requirements] Transformed bibliographic_references:', Object.keys(transformedRefs).length, 'references');
      }
      
      // Remove any custom top-level keys like citation_requirements
      const validRefKeys = Object.keys(bibRefs).filter(key => 
        key.startsWith('ref_') || 
        (typeof bibRefs[key] === 'object' && 
         bibRefs[key].title !== undefined)
      );
      
      if (validRefKeys.length !== Object.keys(bibRefs).length) {
        console.log('[extract-task-requirements] Removing invalid bibliographic_references keys');
        const cleanedRefs: any = {};
        validRefKeys.forEach(key => {
          cleanedRefs[key] = bibRefs[key];
        });
        extracted.bibliographic_references = cleanedRefs;
      }
    }

    // 8. Validate structure
    const arrayFields = [
      'theoretical_concepts',
      'operational_concepts',
      'procedural_knowledge',
      'explicit_rules',
      'domain_vocabulary'
    ];

    for (const field of arrayFields) {
      if (!Array.isArray(extracted[field])) {
        throw new Error(`Missing or invalid field: ${field}`);
      }
    }

    // bibliographic_references should be an object, not an array
    if (!extracted.bibliographic_references || typeof extracted.bibliographic_references !== 'object') {
      throw new Error('Missing or invalid field: bibliographic_references');
    }

    console.log('[extract-task-requirements] Extraction successful:', {
      theoretical_concepts: extracted.theoretical_concepts.length,
      operational_concepts: extracted.operational_concepts.length,
      procedural_knowledge: extracted.procedural_knowledge.length,
      explicit_rules: extracted.explicit_rules.length,
      domain_vocabulary: extracted.domain_vocabulary.length,
      bibliographic_references: Object.keys(extracted.bibliographic_references).length
    });

    // 9. Save to database with filter_prompt_id for version tracking
    const { data: requirement, error: insertError } = await supabase
      .from('agent_task_requirements')
      .upsert({
        agent_id: agentId,
        filter_prompt_id: filterPrompt.id,
        theoretical_concepts: extracted.theoretical_concepts,
        operational_concepts: extracted.operational_concepts,
        procedural_knowledge: extracted.procedural_knowledge,
        explicit_rules: extracted.explicit_rules,
        domain_vocabulary: extracted.domain_vocabulary,
        bibliographic_references: extracted.bibliographic_references,
        extraction_model: llmModel,
        system_prompt_hash: promptHash,
      }, { 
        onConflict: 'agent_id,system_prompt_hash,extraction_model,filter_prompt_id' 
      })
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
