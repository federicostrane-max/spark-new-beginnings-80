// ============================================================
// Edge Function: tool-server-llm
// ============================================================
// Chiama LLM e restituisce risposta RAW (incluso tool_use).
// NON esegue tool internamente - lascia al frontend.
//
// Differenza con agent-chat:
// - agent-chat: loop interno, esegue tool, restituisce risposta finale
// - tool-server-llm: singola chiamata LLM, restituisce tool_use al frontend
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlock[];
  tool_use?: ToolUse;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface RequestBody {
  messages: Message[];
  tools: Tool[];
  model?: string;
  provider?: 'anthropic' | 'openai' | 'google' | 'deepseek';
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
  context?: {
    current_session_id?: string;
    [key: string]: unknown;
  };
}

interface LLMResponse {
  response: string | null;
  tool_use: ToolUse | null;
  stop_reason: string;
  model: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ────────────────────────────────────────────────────────────
// Main Handler
// ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`\n🚀 [${requestId}] tool-server-llm called`);

  try {
    const body: RequestBody = await req.json();
    const {
      messages,
      tools,
      model,
      provider,
      system_prompt,
      max_tokens = 4096,
      temperature = 0.7,
      context,
    } = body;

    if (!messages || !Array.isArray(messages)) {
      throw new Error('messages array is required');
    }

    if (!tools || !Array.isArray(tools)) {
      throw new Error('tools array is required');
    }

    console.log(`📨 [${requestId}] Messages: ${messages.length}, Tools: ${tools.length}`);
    
    if (context?.current_session_id) {
      console.log(`📌 [${requestId}] Session: ${context.current_session_id}`);
    }

    const { selectedProvider, selectedModel } = resolveProviderAndModel(provider, model);
    console.log(`🤖 [${requestId}] Using ${selectedProvider}/${selectedModel}`);

    const fullSystemPrompt = buildSystemPrompt(system_prompt, context);

    let llmResponse: LLMResponse;

    switch (selectedProvider) {
      case 'anthropic':
        llmResponse = await callAnthropic(messages, tools, selectedModel, fullSystemPrompt, max_tokens, temperature, requestId);
        break;
      case 'openai':
        llmResponse = await callOpenAI(messages, tools, selectedModel, fullSystemPrompt, max_tokens, temperature, requestId);
        break;
      case 'google':
        llmResponse = await callGoogle(messages, tools, selectedModel, fullSystemPrompt, max_tokens, temperature, requestId);
        break;
      case 'deepseek':
        llmResponse = await callDeepSeek(messages, tools, selectedModel, fullSystemPrompt, max_tokens, temperature, requestId);
        break;
      default:
        throw new Error(`Unknown provider: ${selectedProvider}`);
    }

    console.log(`✅ [${requestId}] Response: ${llmResponse.tool_use ? `tool_use(${llmResponse.tool_use.name})` : 'text'}`);

    return new Response(JSON.stringify(llmResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`❌ [${requestId}] Error:`, error);
    
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      response: null,
      tool_use: null,
      stop_reason: 'error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ────────────────────────────────────────────────────────────
// Provider/Model Resolution
// ────────────────────────────────────────────────────────────

function resolveProviderAndModel(
  provider?: string,
  model?: string
): { selectedProvider: string; selectedModel: string } {
  
  if (model) {
    if (model.includes('claude')) {
      return { selectedProvider: 'anthropic', selectedModel: model };
    }
    if (model.includes('gpt')) {
      return { selectedProvider: 'openai', selectedModel: model };
    }
    if (model.includes('gemini')) {
      return { selectedProvider: 'google', selectedModel: model };
    }
    if (model.includes('deepseek')) {
      return { selectedProvider: 'deepseek', selectedModel: model };
    }
  }

  if (provider) {
    const defaults: Record<string, string> = {
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o',
      google: 'gemini-2.0-flash',
      deepseek: 'deepseek-chat',
    };
    return { selectedProvider: provider, selectedModel: defaults[provider] || model || '' };
  }

  return {
    selectedProvider: 'anthropic',
    selectedModel: 'claude-sonnet-4-20250514',
  };
}

// ────────────────────────────────────────────────────────────
// System Prompt Builder
// ────────────────────────────────────────────────────────────

function buildSystemPrompt(customPrompt?: string, context?: Record<string, unknown>): string {
  const basePrompt = `You are an AI assistant that can control a web browser through a Tool Server.

CAPABILITIES:
- Start browser sessions and navigate to URLs
- Take screenshots to see the current page
- Get the DOM/Accessibility Tree to understand page structure
- Click on elements using coordinates
- Type text into input fields
- Scroll pages up/down
- Press keyboard keys and combinations

WORKFLOW for browser automation tasks:
1. Start with browser_start to open a URL
2. Use dom_tree to understand the page structure
3. Use screenshot to see the current state
4. Use lux_actor_vision (fast, ~1s) or gemini_computer_use (slower but smarter, ~3s) to find element coordinates
5. Use click/type/scroll/keypress to interact with elements
6. Repeat screenshot → vision → action cycle as needed

COORDINATE SYSTEMS:
- lux_actor_vision returns coordinates in 'lux_sdk' system → use coordinate_origin="lux_sdk" when clicking
- gemini_computer_use returns coordinates in 'viewport' system → use coordinate_origin="viewport" when clicking

IMPORTANT:
- Always use dom_tree first to understand page structure before taking actions
- If an action fails, try screenshot + vision again to verify current state
- Session ID is automatically managed - don't worry about it`;

  let fullPrompt = customPrompt || basePrompt;

  if (context) {
    if (context.current_session_id) {
      fullPrompt += `\n\nCurrent browser session: ${context.current_session_id}`;
    }
  }

  return fullPrompt;
}

// ════════════════════════════════════════════════════════════
// ANTHROPIC (Claude)
// ════════════════════════════════════════════════════════════

async function callAnthropic(
  messages: Message[],
  tools: Tool[],
  model: string,
  systemPrompt: string,
  maxTokens: number,
  temperature: number,
  requestId: string
): Promise<LLMResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const anthropicMessages = convertMessagesToAnthropic(messages);

  const anthropicTools = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));

  console.log(`🔵 [${requestId}] Calling Anthropic API...`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  let textContent = '';
  let toolUse: ToolUse | null = null;

  for (const block of data.content || []) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolUse = {
        id: block.id,
        name: block.name,
        input: block.input,
      };
    }
  }

  return {
    response: textContent || null,
    tool_use: toolUse,
    stop_reason: data.stop_reason,
    model: data.model,
    usage: data.usage,
  };
}

function convertMessagesToAnthropic(messages: Message[]): unknown[] {
  const result: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user' || msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        const blocks = msg.content.map(block => {
          if (block.type === 'tool_result') {
            return {
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            };
          }
          if (block.type === 'image') {
            return {
              type: 'image',
              source: block.source,
            };
          }
          return { type: 'text', text: block.text || '' };
        });
        result.push({ role: msg.role, content: blocks });
      } else if (msg.tool_use) {
        result.push({
          role: 'assistant',
          content: [
            { type: 'tool_use', id: msg.tool_use.id, name: msg.tool_use.name, input: msg.tool_use.input }
          ],
        });
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }
  }

  return result;
}

// ════════════════════════════════════════════════════════════
// OPENAI (GPT)
// ════════════════════════════════════════════════════════════

async function callOpenAI(
  messages: Message[],
  tools: Tool[],
  model: string,
  systemPrompt: string,
  maxTokens: number,
  temperature: number,
  requestId: string
): Promise<LLMResponse> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const openaiMessages = convertMessagesToOpenAI(messages, systemPrompt);

  const openaiTools = tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));

  console.log(`🟢 [${requestId}] Calling OpenAI API...`);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: 'auto',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error('No response from OpenAI');
  }

  let toolUse: ToolUse | null = null;
  if (choice.message.tool_calls?.length > 0) {
    const tc = choice.message.tool_calls[0];
    toolUse = {
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || '{}'),
    };
  }

  return {
    response: choice.message.content || null,
    tool_use: toolUse,
    stop_reason: choice.finish_reason,
    model: data.model,
    usage: data.usage ? {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
    } : undefined,
  };
}

function convertMessagesToOpenAI(messages: Message[], systemPrompt: string): unknown[] {
  const result: unknown[] = [
    { role: 'system', content: systemPrompt }
  ];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (Array.isArray(msg.content)) {
      const toolResults = msg.content.filter(b => b.type === 'tool_result');
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          });
        }
        continue;
      }
      const parts = msg.content.map(block => {
        if (block.type === 'image' && block.source) {
          return {
            type: 'image_url',
            image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` }
          };
        }
        return { type: 'text', text: block.text || '' };
      });
      result.push({ role: msg.role, content: parts });
    } else if (msg.tool_use) {
      result.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: msg.tool_use.id,
          type: 'function',
          function: {
            name: msg.tool_use.name,
            arguments: JSON.stringify(msg.tool_use.input),
          },
        }],
      });
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}

// ════════════════════════════════════════════════════════════
// GOOGLE (Gemini)
// ════════════════════════════════════════════════════════════

async function callGoogle(
  messages: Message[],
  tools: Tool[],
  model: string,
  systemPrompt: string,
  maxTokens: number,
  temperature: number,
  requestId: string
): Promise<LLMResponse> {
  const apiKey = Deno.env.get('GOOGLE_AI_STUDIO_API_KEY');
  if (!apiKey) throw new Error('GOOGLE_AI_STUDIO_API_KEY not configured');

  const geminiContents = convertMessagesToGemini(messages);

  const geminiTools = [{
    function_declarations: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    })),
  }];

  console.log(`🔴 [${requestId}] Calling Google Gemini API...`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: geminiContents,
      tools: geminiTools,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];

  if (!candidate) {
    throw new Error('No response from Gemini');
  }

  let textContent = '';
  let toolUse: ToolUse | null = null;

  for (const part of candidate.content?.parts || []) {
    if (part.text) {
      textContent += part.text;
    } else if (part.functionCall) {
      toolUse = {
        id: crypto.randomUUID(),
        name: part.functionCall.name,
        input: part.functionCall.args || {},
      };
    }
  }

  return {
    response: textContent || null,
    tool_use: toolUse,
    stop_reason: candidate.finishReason || 'stop',
    model,
    usage: data.usageMetadata ? {
      input_tokens: data.usageMetadata.promptTokenCount,
      output_tokens: data.usageMetadata.candidatesTokenCount,
    } : undefined,
  };
}

function convertMessagesToGemini(messages: Message[]): unknown[] {
  const result: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (Array.isArray(msg.content)) {
      const toolResults = msg.content.filter(b => b.type === 'tool_result');
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          result.push({
            role: 'user',
            parts: [{
              functionResponse: {
                name: 'tool_result',
                response: { content: tr.content },
              },
            }],
          });
        }
        continue;
      }

      const parts = msg.content.map(block => {
        if (block.type === 'image' && block.source) {
          return {
            inlineData: {
              mimeType: block.source.media_type,
              data: block.source.data,
            },
          };
        }
        return { text: block.text || '' };
      });
      result.push({ role, parts });
    } else if (msg.tool_use) {
      result.push({
        role: 'model',
        parts: [{
          functionCall: {
            name: msg.tool_use.name,
            args: msg.tool_use.input,
          },
        }],
      });
    } else {
      result.push({ role, parts: [{ text: msg.content as string }] });
    }
  }

  return result;
}

// ════════════════════════════════════════════════════════════
// DEEPSEEK
// ════════════════════════════════════════════════════════════

async function callDeepSeek(
  messages: Message[],
  tools: Tool[],
  model: string,
  systemPrompt: string,
  maxTokens: number,
  temperature: number,
  requestId: string
): Promise<LLMResponse> {
  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

  const deepseekMessages = convertMessagesToOpenAI(messages, systemPrompt);

  const deepseekTools = tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));

  console.log(`🟣 [${requestId}] Calling DeepSeek API...`);

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: deepseekMessages,
      tools: deepseekTools,
      tool_choice: 'auto',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error('No response from DeepSeek');
  }

  let toolUse: ToolUse | null = null;
  if (choice.message.tool_calls?.length > 0) {
    const tc = choice.message.tool_calls[0];
    toolUse = {
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || '{}'),
    };
  }

  return {
    response: choice.message.content || null,
    tool_use: toolUse,
    stop_reason: choice.finish_reason,
    model: data.model,
    usage: data.usage ? {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
    } : undefined,
  };
}
