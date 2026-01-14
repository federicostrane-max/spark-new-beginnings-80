// ============================================================
// React Hook - Agent con Tool Server Integration
// ============================================================
// IMPORTANTE: Usa 'tool-server-llm' invece di 'agent-chat'
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { executeToolUse, sessionManager, toolServerClient } from '@/lib/tool-server';
import type { ToolUse, ToolResult, AgentMessage } from '@/lib/tool-server';

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

interface AgentState {
  isRunning: boolean;
  isConnected: boolean;
  sessionId: string | null;
  messages: AgentMessage[];
  error: string | null;
}

interface UseToolServerAgentOptions {
  model?: string;
  provider?: 'anthropic' | 'openai' | 'google' | 'deepseek';
  maxIterations?: number;
}

interface UseToolServerAgentReturn extends AgentState {
  sendMessage: (message: string) => Promise<void>;
  stopAgent: () => void;
  checkConnection: () => Promise<boolean>;
  startBrowserSession: (url: string) => Promise<string>;
  endBrowserSession: () => Promise<void>;
  clearMessages: () => void;
}

// ──────────────────────────────────────────────────────────
// Tool Definitions - Hybrid (Custom + Claude Native)
// ──────────────────────────────────────────────────────────

// Viewport dimensions for Claude Computer Use
const VIEWPORT_WIDTH = 1260;
const VIEWPORT_HEIGHT = 700;

const TOOLS = [
  // ════════════════════════════════════════════════════════
  // CUSTOM TOOLS (Tool Server)
  // ════════════════════════════════════════════════════════
  {
    name: 'tool_server_action',
    description: `Execute actions on the local desktop app (Tool Server port 8766).

AVAILABLE ACTIONS:
- browser_start: Open URL in Edge (persistent profile, keeps logins)
- screenshot: Capture current screen state
- dom_tree: Get page accessibility tree (text structure)
- element_rect: Find element coordinates by selector/text/role
- click: Click at coordinates
- type: Type text into focused element
- scroll: Scroll page (up/down)
- keypress: Press keys (Enter, Tab, Ctrl+A, etc.)
- hold_key: Hold a key for duration
- wait: Wait for specified duration (seconds)
- browser_navigate: Go to URL
- browser_stop: Close browser

COORDINATE SYSTEMS:
- viewport: Pixel coordinates in ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}
- lux_sdk: From Lux Actor (1:1 with viewport)
- normalized: 0-999 range (auto-converted)

WORKFLOW:
1. browser_start → open URL
2. dom_tree → understand page
3. element_rect or vision tool → get coordinates
4. click/type/scroll → interact
5. screenshot → verify result`,
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['screenshot', 'dom_tree', 'element_rect', 'click', 'type', 'scroll', 'keypress',
                 'hold_key', 'wait', 'browser_start', 'browser_navigate', 'browser_stop'],
          description: 'Action to execute'
        },
        scope: {
          type: 'string',
          enum: ['browser', 'desktop'],
          description: 'Scope: browser (viewport) or desktop (full screen)'
        },
        session_id: {
          type: 'string',
          description: 'Browser session ID (auto-managed)'
        },
        x: { type: 'number', description: 'X coordinate for click' },
        y: { type: 'number', description: 'Y coordinate for click' },
        coordinate_origin: {
          type: 'string',
          enum: ['viewport', 'lux_sdk', 'normalized'],
          description: 'Coordinate system'
        },
        click_type: {
          type: 'string',
          enum: ['single', 'double', 'right', 'triple'],
          description: 'Click type (default: single)'
        },
        text: { type: 'string', description: 'Text to type, or text to find element' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Scroll amount in pixels (default: 500)' },
        keys: { type: 'string', description: 'Keys to press (e.g., "Enter", "Control+A")' },
        duration: { type: 'number', description: 'Duration in seconds for hold_key/wait' },
        start_url: { type: 'string', description: 'Initial URL for browser_start' },
        url: { type: 'string', description: 'URL for browser_navigate' },
        selector: { type: 'string', description: 'CSS selector for element_rect' },
        role: { type: 'string', description: 'ARIA role to find element' },
        label: { type: 'string', description: 'Accessible label to find element' },
        placeholder: { type: 'string', description: 'Input placeholder to find element' }
      },
      required: ['action']
    }
  },

  // ════════════════════════════════════════════════════════
  // VISION TOOLS (Cloud APIs)
  // ════════════════════════════════════════════════════════
  {
    name: 'lux_actor_vision',
    description: `Locate elements visually using Lux Actor API.
FAST (~1 second). Best for buttons, links, standard UI.
Returns 'lux_sdk' coordinates → use with coordinate_origin="lux_sdk"`,
    input_schema: {
      type: 'object',
      properties: {
        screenshot: {
          type: 'string',
          description: 'Screenshot in base64'
        },
        target: {
          type: 'string',
          description: 'Element to find (e.g., "blue Compose button")'
        }
      },
      required: ['screenshot', 'target']
    }
  },
  {
    name: 'gemini_computer_use',
    description: `Locate elements using Gemini Vision.
SLOWER (~3s) but SMARTER. Best for complex UI, when lux fails.
Returns 'viewport' coordinates → use with coordinate_origin="viewport"`,
    input_schema: {
      type: 'object',
      properties: {
        screenshot: { type: 'string', description: 'Screenshot in base64' },
        target: { type: 'string', description: 'Element to find' },
        context: { type: 'string', description: 'Additional context' }
      },
      required: ['screenshot', 'target']
    }
  }
];

// Note: The native Claude 'computer' tool is added by the edge function
// when enable_computer_use=true. It provides:
// - key: Press key combinations
// - type: Type text
// - mouse_move: Move cursor
// - left_click, right_click, middle_click, double_click, triple_click
// - left_click_drag: Drag from start to end
// - screenshot: Take screenshot
// - cursor_position: Get current cursor position
// - scroll: Scroll in direction
// - hold_key: Hold key for duration
// - wait: Wait for duration

// ──────────────────────────────────────────────────────────
// Hook Implementation
// ──────────────────────────────────────────────────────────

export function useToolServerAgent(
  options: UseToolServerAgentOptions = {}
): UseToolServerAgentReturn {
  
  const {
    model = 'claude-sonnet-4-20250514',
    provider = 'anthropic',
    maxIterations = 25
  } = options;

  const [state, setState] = useState<AgentState>({
    isRunning: false,
    isConnected: false,
    sessionId: null,
    messages: [],
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  // ════════════════════════════════════════════════════════
  // Session Manager Sync
  // ════════════════════════════════════════════════════════

  useEffect(() => {
    const unsubscribe = sessionManager.subscribe((sessionId) => {
      setState(prev => ({ ...prev, sessionId }));
    });
    return unsubscribe;
  }, []);

  // ════════════════════════════════════════════════════════
  // Connection Check
  // ════════════════════════════════════════════════════════

  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const isConnected = await toolServerClient.checkHealth();
      setState(prev => ({ ...prev, isConnected }));
      return isConnected;
    } catch {
      setState(prev => ({ ...prev, isConnected: false }));
      return false;
    }
  }, []);

  // Check connection on mount and periodically
  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  // ════════════════════════════════════════════════════════
  // Browser Session Management
  // ════════════════════════════════════════════════════════

  const startBrowserSession = useCallback(async (url: string): Promise<string> => {
    return sessionManager.startSession(url);
  }, []);

  const endBrowserSession = useCallback(async (): Promise<void> => {
    return sessionManager.endSession();
  }, []);

  // ════════════════════════════════════════════════════════
  // Agent Control
  // ════════════════════════════════════════════════════════

  const stopAgent = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState(prev => ({ ...prev, isRunning: false }));
  }, []);

  const clearMessages = useCallback(() => {
    setState(prev => ({ ...prev, messages: [], error: null }));
  }, []);

  // ════════════════════════════════════════════════════════
  // Main Agent Loop
  // ════════════════════════════════════════════════════════

  const sendMessage = useCallback(async (userMessage: string): Promise<void> => {
    // Check if configured first
    if (!toolServerClient.isConfigured()) {
      setState(prev => ({
        ...prev,
        error: 'Tool Server non configurato. Apri le impostazioni e salva il tuo URL ngrok.'
      }));
      return;
    }
    
    // Check connection
    const isConnected = await checkConnection();
    if (!isConnected) {
      const configuredUrl = toolServerClient.getConfiguredUrl();
      setState(prev => ({
        ...prev,
        error: `Tool Server non raggiungibile all'URL: ${configuredUrl}. Verifica che ngrok sia attivo.`
      }));
      return;
    }

    // Setup
    abortControllerRef.current = new AbortController();
    setState(prev => ({
      ...prev,
      isRunning: true,
      error: null,
      messages: [...prev.messages, { role: 'user', content: userMessage }]
    }));

    // Conversation history for LLM
    const conversationHistory: Array<{
      role: string;
      content: string | Array<{
        type: string;
        tool_use_id?: string;
        content?: string;
        is_error?: boolean;
        text?: string;
      }> | null;
      tool_use?: ToolUse;
    }> = [
      { role: 'user', content: userMessage }
    ];

    try {
      let iteration = 0;

      // ══════════════════════════════════════════════════
      // Agent Loop
      // ══════════════════════════════════════════════════

      while (iteration < maxIterations) {
        iteration++;

        // Check abort
        if (abortControllerRef.current?.signal.aborted) {
          console.log('🛑 Agent stopped by user');
          break;
        }

        console.log(`\n🔄 [Iteration ${iteration}/${maxIterations}]`);

        // ────────────────────────────────────────────────
        // 1. Call LLM via Edge Function
        // ────────────────────────────────────────────────
        // IMPORTANTE: Usa 'tool-server-llm', NON 'agent-chat'!
        
        const { data: llmResponse, error: llmError } = await supabase.functions.invoke(
          'tool-server-llm',
          {
            body: {
              messages: conversationHistory,
              tools: TOOLS,
              model,
              provider,
              context: {
                current_session_id: sessionManager.sessionId,
                screen_width: VIEWPORT_WIDTH,
                screen_height: VIEWPORT_HEIGHT,
              },
              // Claude Computer Use options
              enable_computer_use: provider === 'anthropic',
              enable_prompt_caching: true,
              enable_token_efficient_tools: true,
              max_recent_images: 10,
            }
          }
        );

        if (llmError) {
          throw new Error(`LLM error: ${llmError.message}`);
        }

        // Check for errors in response
        if (llmResponse.error) {
          throw new Error(llmResponse.error);
        }

        // ────────────────────────────────────────────────
        // 2. Handle tool_use
        // ────────────────────────────────────────────────

        if (llmResponse.tool_use) {
          const toolUse: ToolUse = llmResponse.tool_use;
          console.log(`🔧 Tool requested: ${toolUse.name}`, toolUse.input);

          // Add assistant message with tool_use to history
          conversationHistory.push({
            role: 'assistant',
            content: llmResponse.response || null,
            tool_use: toolUse
          });

          // ──────────────────────────────────────────────
          // 3. Execute tool LOCALLY (in browser!)
          // ──────────────────────────────────────────────

          const toolResult: ToolResult = await executeToolUse(
            toolUse,
            sessionManager.sessionId || undefined
          );

          // ══════════════════════════════════════════════════
          // DEBUG: Log tool result content size and type
          // ══════════════════════════════════════════════════
          const resultContent = typeof toolResult.content === 'string' 
            ? toolResult.content 
            : JSON.stringify(toolResult.content);
          
          console.log(`📤 Tool result for ${toolUse.name}:`, {
            is_error: toolResult.is_error,
            content_type: typeof toolResult.content,
            content_length: resultContent.length,
            content_preview: resultContent.substring(0, 500) + (resultContent.length > 500 ? '...' : ''),
          });

          // For dom_tree, log more details
          if (toolUse.name === 'tool_server_action' && 
              (toolUse.input as Record<string, unknown>).action === 'dom_tree') {
            console.log(`🌳 DOM Tree result:`, {
              full_length: resultContent.length,
              has_tree: toolResult.content && typeof toolResult.content === 'object' && 'tree' in toolResult.content,
              tree_type: toolResult.content && typeof toolResult.content === 'object' ? typeof (toolResult.content as Record<string, unknown>).tree : 'N/A',
            });
          }

          // Capture session_id if present
          if (
            typeof toolResult.content === 'object' &&
            toolResult.content !== null &&
            'session_id' in toolResult.content
          ) {
            sessionManager.captureFromToolResult(toolResult.content as Record<string, unknown>);
          }

          // ══════════════════════════════════════════════════
          // IMPORTANT: Truncate very large DOM trees to prevent
          // context overflow while keeping useful structure
          // ══════════════════════════════════════════════════
          let finalContent = resultContent;
          const MAX_TOOL_RESULT_CHARS = 50000; // 50KB limit
          
          if (resultContent.length > MAX_TOOL_RESULT_CHARS) {
            console.warn(`⚠️ Tool result truncated from ${resultContent.length} to ${MAX_TOOL_RESULT_CHARS} chars`);
            finalContent = resultContent.substring(0, MAX_TOOL_RESULT_CHARS) + 
              '\n... [TRUNCATED - DOM too large, showing first 50KB]';
          }

          // Add tool result to history (as user message per Anthropic format)
          conversationHistory.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolResult.tool_use_id,
              content: finalContent,
              is_error: toolResult.is_error
            }]
          });

          // Continue loop
          continue;
        }

        // ────────────────────────────────────────────────
        // 4. Final response (no tool_use)
        // ────────────────────────────────────────────────

        if (llmResponse.response) {
          console.log(`✅ Final response received`);
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'assistant', content: llmResponse.response }]
          }));
          break;
        }

        // Safety: neither tool_use nor response
        console.warn('⚠️ LLM returned neither tool_use nor response');
        break;
      }

      // Max iterations warning
      if (iteration >= maxIterations) {
        console.warn(`⚠️ Max iterations (${maxIterations}) reached`);
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages, 
            { role: 'assistant', content: `Ho raggiunto il limite di ${maxIterations} iterazioni. Potrei non aver completato il task.` }
          ]
        }));
      }

    } catch (error) {
      console.error('❌ Agent error:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    } finally {
      setState(prev => ({ ...prev, isRunning: false }));
      abortControllerRef.current = null;
    }
  }, [checkConnection, model, provider, maxIterations]);

  // ════════════════════════════════════════════════════════
  // Return
  // ════════════════════════════════════════════════════════

  return {
    ...state,
    sendMessage,
    stopAgent,
    checkConnection,
    startBrowserSession,
    endBrowserSession,
    clearMessages
  };
}

export default useToolServerAgent;
