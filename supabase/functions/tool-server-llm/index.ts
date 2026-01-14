// ============================================================
// Edge Function: tool-server-llm v2.0.0
// ============================================================
// Chiama LLM e restituisce risposta RAW (incluso tool_use).
// NON esegue tool internamente - lascia al frontend.
//
// v2.0.0: Claude Computer Use Native Support
// - Beta flags per computer-use-2025-01-24
// - Prompt caching per ridurre costi
// - Image filtering per vecchi screenshot
// - System prompt ottimizzato per Windows/Edge
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ────────────────────────────────────────────────────────────
// Constants - Claude Computer Use
// ────────────────────────────────────────────────────────────

const COMPUTER_USE_BETA_FLAG = "computer-use-2025-01-24";
const PROMPT_CACHING_BETA_FLAG = "prompt-caching-2024-07-31";
const TOKEN_EFFICIENT_TOOLS_BETA = "token-efficient-tools-2025-02-19";

// Default viewport dimensions (matching Lux SDK)
const VIEWPORT_WIDTH = 1260;
const VIEWPORT_HEIGHT = 700;

// Max images to keep in conversation (older ones are filtered)
const MAX_RECENT_IMAGES = 10;

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
    screen_width?: number;
    screen_height?: number;
    [key: string]: unknown;
  };
  // Claude Computer Use options
  enable_computer_use?: boolean;
  enable_prompt_caching?: boolean;
  enable_token_efficient_tools?: boolean;
  max_recent_images?: number;
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
      enable_computer_use = true,  // Default: enabled for Anthropic
      enable_prompt_caching = true,
      enable_token_efficient_tools = true,
      max_recent_images = MAX_RECENT_IMAGES,
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

    // ══════════════════════════════════════════════════════════
    // DEBUG: Log tool_result content sizes
    // ══════════════════════════════════════════════════════════
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            const contentLen = typeof block.content === 'string' 
              ? block.content.length 
              : JSON.stringify(block.content).length;
            console.log(`🔧 [${requestId}] Message[${i}] has tool_result: ${contentLen} chars, is_error=${block.is_error}`);
            
            // Check if it's a DOM tree result
            if (typeof block.content === 'string' && block.content.includes('"tree"')) {
              console.log(`🌳 [${requestId}] DOM tree detected in tool_result`);
            }
          }
        }
      }
    }

    const { selectedProvider, selectedModel } = resolveProviderAndModel(provider, model);
    console.log(`🤖 [${requestId}] Using ${selectedProvider}/${selectedModel}`);

    const fullSystemPrompt = buildSystemPrompt(system_prompt, context);

    let llmResponse: LLMResponse;

    switch (selectedProvider) {
      case 'anthropic':
        llmResponse = await callAnthropic(
          messages,
          tools,
          selectedModel,
          fullSystemPrompt,
          max_tokens,
          temperature,
          requestId,
          {
            enableComputerUse: enable_computer_use,
            enablePromptCaching: enable_prompt_caching,
            enableTokenEfficientTools: enable_token_efficient_tools,
            maxRecentImages: max_recent_images,
            screenWidth: context?.screen_width || VIEWPORT_WIDTH,
            screenHeight: context?.screen_height || VIEWPORT_HEIGHT,
          }
        );
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
// System Prompt Builder - Optimized for Windows/Edge
// ────────────────────────────────────────────────────────────

function buildSystemPrompt(customPrompt?: string, context?: Record<string, unknown>): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const basePrompt = `<SYSTEM_CAPABILITY>
* You are controlling a Windows desktop with Microsoft Edge browser through a Tool Server.
* The browser viewport is ${context?.screen_width || VIEWPORT_WIDTH}x${context?.screen_height || VIEWPORT_HEIGHT} pixels.
* You can take screenshots, click, type, scroll, and press keys.
* You have access to both DOM-based and vision-based element location.
* The current date is ${today}.
</SYSTEM_CAPABILITY>

<TOOLS_AVAILABLE>
1. **tool_server_action** - Direct browser/desktop control:
   - browser_start: Open URL in Edge (persistent profile, keeps logins)
   - screenshot: Capture current screen state
   - dom_tree: Get page structure as accessibility tree
   - element_rect: Find element coordinates by selector/text/role (NO vision needed!)
   - click: Click at coordinates
   - type: Type text
   - scroll: Scroll up/down
   - keypress: Press keys (Enter, Tab, Ctrl+A, etc.)
   - hold_key: Hold a key for duration
   - wait: Wait for specified duration
   - browser_navigate: Go to URL
   - browser_stop: Close browser

2. **computer** (Claude native) - Native computer control:
   - All standard computer use actions with automatic screenshots

3. **lux_actor_vision** - Fast visual element location (~1s):
   - Returns 'lux_sdk' coordinates
   - Best for: buttons, links, standard UI elements

4. **gemini_computer_use** - Smart visual element location (~3s):
   - Returns 'viewport' coordinates
   - Best for: complex UI, when lux fails
</TOOLS_AVAILABLE>

<WORKFLOW_DOM_BASED>
Prefer this when elements have clear selectors/text:
1. browser_start → open URL
2. dom_tree → understand page structure
3. element_rect → get precise coordinates by selector/text/role
4. click/type/scroll → interact
5. Repeat as needed
</WORKFLOW_DOM_BASED>

<WORKFLOW_VISION_BASED>
Use when DOM approach fails or for visual elements:
1. browser_start → open URL
2. screenshot → capture current state
3. lux_actor_vision OR gemini_computer_use → find element coordinates
4. click with correct coordinate_origin → interact
5. screenshot → verify result
6. Repeat as needed
</WORKFLOW_VISION_BASED>

<COORDINATE_SYSTEMS>
- 'viewport': Pixel coordinates in ${context?.screen_width || VIEWPORT_WIDTH}x${context?.screen_height || VIEWPORT_HEIGHT} space
- 'lux_sdk': Coordinates from Lux Actor (1:1 with viewport)
- 'normalized': 0-999 range (Gemini raw output, auto-converted)
IMPORTANT: Always specify coordinate_origin when clicking!
</COORDINATE_SYSTEMS>

<TIPS>
* Take a screenshot after every significant action to verify the result
* If an element is not found, try scrolling or waiting for page load
* Use dom_tree + element_rect first (faster than vision)
* For login forms, the browser keeps session cookies - you may already be logged in
* When typing URLs, use the address bar (usually accessible via Ctrl+L)
* If a popup appears, handle it before continuing with the main task
</TIPS>`;

  let fullPrompt = customPrompt || basePrompt;

  if (context) {
    if (context.current_session_id) {
      fullPrompt += `\n\n<CURRENT_STATE>\nBrowser session active: ${context.current_session_id}\n</CURRENT_STATE>`;
    }
  }

  return fullPrompt;
}

// ════════════════════════════════════════════════════════════
// ANTHROPIC (Claude) - With Computer Use Support
// ════════════════════════════════════════════════════════════

interface AnthropicOptions {
  enableComputerUse: boolean;
  enablePromptCaching: boolean;
  enableTokenEfficientTools: boolean;
  maxRecentImages: number;
  screenWidth: number;
  screenHeight: number;
}

async function callAnthropic(
  messages: Message[],
  tools: Tool[],
  model: string,
  systemPrompt: string,
  maxTokens: number,
  temperature: number,
  requestId: string,
  options: AnthropicOptions
): Promise<LLMResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // Build beta flags
  const betas: string[] = [];
  if (options.enableComputerUse) {
    betas.push(COMPUTER_USE_BETA_FLAG);
  }
  if (options.enablePromptCaching) {
    betas.push(PROMPT_CACHING_BETA_FLAG);
  }
  if (options.enableTokenEfficientTools) {
    betas.push(TOKEN_EFFICIENT_TOOLS_BETA);
  }

  console.log(`🔵 [${requestId}] Betas: ${betas.join(', ') || 'none'}`);

  // Filter old images to save tokens
  const filteredMessages = filterOldImages(messages, options.maxRecentImages);

  // Convert messages with prompt caching
  const anthropicMessages = convertMessagesToAnthropic(filteredMessages, options.enablePromptCaching);

  // Build tools array - include native computer tool if enabled
  const anthropicTools: unknown[] = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));

  // Add native Claude computer tool
  if (options.enableComputerUse) {
    anthropicTools.push({
      type: 'computer_20250124',
      name: 'computer',
      display_width_px: options.screenWidth,
      display_height_px: options.screenHeight,
    });
    console.log(`🖥️ [${requestId}] Computer tool: ${options.screenWidth}x${options.screenHeight}`);
  }

  // Build system with cache control
  const system = options.enablePromptCaching
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    : systemPrompt;

  console.log(`🔵 [${requestId}] Calling Anthropic API...`);

  const requestBody: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: anthropicMessages,
    tools: anthropicTools,
  };

  // Add betas header if any
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  if (betas.length > 0) {
    headers['anthropic-beta'] = betas.join(',');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
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

  // Log cache performance if available
  if (data.usage?.cache_creation_input_tokens || data.usage?.cache_read_input_tokens) {
    console.log(`💾 [${requestId}] Cache: created=${data.usage.cache_creation_input_tokens || 0}, read=${data.usage.cache_read_input_tokens || 0}`);
  }

  return {
    response: textContent || null,
    tool_use: toolUse,
    stop_reason: data.stop_reason,
    model: data.model,
    usage: data.usage,
  };
}

// ────────────────────────────────────────────────────────────
// Image Filtering - Remove old screenshots to save tokens
// ────────────────────────────────────────────────────────────

function filterOldImages(messages: Message[], maxImages: number): Message[] {
  if (maxImages <= 0) return messages;

  // Count total images
  let totalImages = 0;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'image' || (block.type === 'tool_result' && typeof block.content === 'object')) {
          totalImages++;
        }
      }
    }
  }

  if (totalImages <= maxImages) return messages;

  // Need to filter - keep only most recent images
  const imagesToRemove = totalImages - maxImages;
  let removed = 0;

  return messages.map(msg => {
    if (!Array.isArray(msg.content)) return msg;

    const filteredContent = msg.content.filter(block => {
      if (block.type === 'image' && removed < imagesToRemove) {
        removed++;
        return false; // Remove this image
      }
      return true;
    });

    return { ...msg, content: filteredContent };
  });
}

function convertMessagesToAnthropic(messages: Message[], enableCaching: boolean = false): unknown[] {
  const result: unknown[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'system') continue;

    // For prompt caching, add cache_control to recent user messages
    const isRecentUserMessage = enableCaching &&
      msg.role === 'user' &&
      i >= messages.length - 3; // Last 3 user messages

    if (msg.role === 'user' || msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        const blocks = msg.content.map((block, blockIdx) => {
          const isLastBlock = blockIdx === msg.content.length - 1;

          if (block.type === 'tool_result') {
            const result: Record<string, unknown> = {
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            };
            // Add cache control to last block of recent messages
            if (isRecentUserMessage && isLastBlock) {
              result.cache_control = { type: 'ephemeral' };
            }
            return result;
          }
          if (block.type === 'image') {
            return {
              type: 'image',
              source: block.source,
            };
          }
          const textBlock: Record<string, unknown> = { type: 'text', text: block.text || '' };
          if (isRecentUserMessage && isLastBlock) {
            textBlock.cache_control = { type: 'ephemeral' };
          }
          return textBlock;
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
        const content = isRecentUserMessage
          ? [{ type: 'text', text: msg.content as string, cache_control: { type: 'ephemeral' } }]
          : msg.content;
        result.push({ role: msg.role, content });
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
