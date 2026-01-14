// ============================================================
// Tool Executor - Esegue tool nel frontend
// CRITICAL: Blocca azioni locali se Tool Server non configurato
// ============================================================

import { toolServerClient } from './client';
import { supabase } from '@/integrations/supabase/client';
import type {
  ToolUse,
  ToolResult,
  ToolServerActionInput,
  LuxActorInput,
  GeminiVisionInput,
} from './types';

// ──────────────────────────────────────────────────────────
// Tool Router
// ──────────────────────────────────────────────────────────

export async function executeToolUse(
  toolUse: ToolUse,
  sessionId?: string
): Promise<ToolResult> {
  const { id, name, input } = toolUse;

  console.log(`🔧 Executing tool: ${name}`, input);

  try {
    let result: Record<string, unknown>;

    switch (name) {
      // ════════════════════════════════════════════════════
      // LOCAL: Tool Server Actions (eseguite nel browser)
      // CRITICAL: Blocca se non configurato!
      // ════════════════════════════════════════════════════
      case 'tool_server_action':
        // ⛔ GUARD: Blocca TUTTE le azioni locali se non configurato
        if (!toolServerClient.isConfigured()) {
          console.warn('⛔ Tool Server non configurato, blocco azione:', input);
          result = {
            success: false,
            error: 'Tool Server non configurato. Apri le impostazioni (icona 🟡 in alto) e salva il tuo URL ngrok.',
          };
          break;
        }
        result = await executeToolServerAction(input as unknown as ToolServerActionInput, sessionId);
        break;

      // ════════════════════════════════════════════════════
      // CLOUD: Vision APIs (via Edge Function)
      // ════════════════════════════════════════════════════
      case 'lux_actor_vision':
        result = await executeLuxActorVision(input as unknown as LuxActorInput);
        break;

      case 'gemini_computer_use':
        result = await executeGeminiVision(input as unknown as GeminiVisionInput);
        break;

      // ════════════════════════════════════════════════════
      // Unknown tool
      // ════════════════════════════════════════════════════
      default:
        result = {
          success: false,
          error: `Unknown tool: ${name}`,
        };
    }

    console.log(`✅ Tool ${name} result:`, result.success ? 'success' : result.error);

    return {
      tool_use_id: id,
      content: result,
      is_error: !result.success,
    };

  } catch (error) {
    console.error(`❌ Tool ${name} error:`, error);

    return {
      tool_use_id: id,
      content: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      is_error: true,
    };
  }
}

// ──────────────────────────────────────────────────────────
// Tool Server Action (LOCAL - HTTP a 127.0.0.1:8766)
// ──────────────────────────────────────────────────────────

async function executeToolServerAction(
  input: ToolServerActionInput,
  currentSessionId?: string
): Promise<Record<string, unknown>> {
  
  // Auto-inject session_id se non fornito
  const sessionId = input.session_id || currentSessionId;

  switch (input.action) {
    case 'browser_start':
      return toolServerClient.browserStart(input.start_url || 'https://google.com');

    case 'browser_stop':
      if (!sessionId) throw new Error('session_id required for browser_stop');
      return toolServerClient.browserStop(sessionId);

    case 'browser_navigate':
      if (!sessionId) throw new Error('session_id required for browser_navigate');
      if (!input.url) throw new Error('url required for browser_navigate');
      return toolServerClient.browserNavigate(sessionId, input.url);

    case 'screenshot':
      return toolServerClient.screenshot({
        scope: input.scope || 'browser',
        session_id: sessionId,
        optimize_for: 'lux',
      });

    case 'dom_tree':
      if (!sessionId) throw new Error('session_id required for dom_tree');
      return toolServerClient.getDomTree(sessionId);

    case 'click':
      if (input.x === undefined || input.y === undefined) {
        throw new Error('x and y coordinates required for click');
      }
      return toolServerClient.click({
        scope: input.scope || 'browser',
        x: input.x,
        y: input.y,
        session_id: sessionId,
        coordinate_origin: input.coordinate_origin || 'viewport',
        click_type: input.click_type || 'single',
      });

    case 'type':
      if (!input.text) throw new Error('text required for type');
      return toolServerClient.type({
        scope: input.scope || 'browser',
        text: input.text,
        session_id: sessionId,
      });

    case 'scroll':
      return toolServerClient.scroll({
        scope: input.scope || 'browser',
        direction: input.direction || 'down',
        amount: input.amount || 500,
        session_id: sessionId,
      });

    case 'keypress':
      if (!input.keys) throw new Error('keys required for keypress');
      return toolServerClient.keypress({
        scope: input.scope || 'browser',
        keys: input.keys,
        session_id: sessionId,
      });

    case 'element_rect':
    case 'browser_element_rect':
      if (!sessionId) throw new Error('session_id required for element_rect');
      return toolServerClient.getElementRect({
        session_id: sessionId,
        selector: input.selector,
        text: input.text,
        role: input.role,
        test_id: input.test_id,
        label: input.label,
        placeholder: input.placeholder,
      });

    default:
      throw new Error(`Unknown action: ${input.action}`);
  }
}

// ──────────────────────────────────────────────────────────
// Lux Actor Vision (CLOUD - via Edge Function)
// ──────────────────────────────────────────────────────────

async function executeLuxActorVision(input: LuxActorInput): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('tool-server-vision', {
    body: {
      provider: 'lux',
      image: input.screenshot,
      task: `Find and locate: ${input.target}`,
      model: 'lux-actor-1',
    },
  });

  if (error) {
    throw new Error(`Lux API error: ${error.message}`);
  }

  if (!data.success) {
    return {
      success: false,
      error: data.error || 'Lux failed to locate element',
    };
  }

  return {
    success: true,
    x: data.x,
    y: data.y,
    confidence: data.confidence || 1.0,
    coordinate_system: 'viewport',  // Edge function already converts lux_sdk → viewport
    source: 'lux_actor_vision',
    viewport: { width: 1260, height: 700 },
    usage_hint: 'Use these coordinates with tool_server_action click and coordinate_origin="viewport"',
  };
}

// ──────────────────────────────────────────────────────────
// Gemini Vision (CLOUD - via Edge Function)
// ──────────────────────────────────────────────────────────

async function executeGeminiVision(input: GeminiVisionInput): Promise<Record<string, unknown>> {
  const prompt = `Find the element "${input.target}" in the screenshot.
${input.context ? `Context: ${input.context}` : ''}
Viewport: 1260x700 pixels.
Coordinates (0,0) = top left corner.

Respond ONLY with valid JSON:
{"x": number, "y": number, "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

  const { data, error } = await supabase.functions.invoke('tool-server-vision', {
    body: {
      provider: 'gemini',
      image: input.screenshot,
      prompt,
    },
  });

  if (error) {
    throw new Error(`Gemini API error: ${error.message}`);
  }

  if (!data.success) {
    return {
      success: false,
      error: data.error || 'Gemini failed to locate element',
      reasoning: data.reasoning,
    };
  }

  return {
    success: true,
    x: data.x,
    y: data.y,
    confidence: data.confidence || 0.8,
    reasoning: data.reasoning,
    coordinate_system: 'viewport',  // Edge function converts normalized (0-999) → viewport
    source: 'gemini_computer_use',
    viewport: { width: 1260, height: 700 },
    usage_hint: 'Use these coordinates with tool_server_action click and coordinate_origin="viewport"',
  };
}
