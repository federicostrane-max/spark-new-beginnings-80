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
// Tool Definitions
// ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'tool_server_action',
    description: `Execute actions on the local desktop app (Tool Server port 8766).
Available actions:
- browser_start: Start browser with initial URL (returns session_id)
- screenshot: Capture screen (browser or desktop), returns base64 image
- dom_tree: Get Accessibility Tree of the page (text structure)
- click: Click at specific coordinates
- type: Type text into focused element
- scroll: Scroll page (up/down)
- keypress: Press keys/combinations (e.g., "Enter", "Control+C")
- browser_navigate: Navigate to URL
- browser_stop: Close browser session

WORKFLOW:
1. browser_start → get session_id
2. dom_tree → understand page structure
3. screenshot → see current state
4. Use lux_actor_vision or gemini_computer_use to find coordinates
5. click/type/scroll/keypress to interact
6. Repeat as needed`,
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['screenshot', 'dom_tree', 'click', 'type', 'scroll', 'keypress',
                 'browser_start', 'browser_navigate', 'browser_stop'],
          description: 'Action to execute'
        },
        scope: { 
          type: 'string', 
          enum: ['browser', 'desktop'],
          description: 'Scope: browser (viewport only) or desktop (full screen)'
        },
        session_id: { 
          type: 'string',
          description: 'Browser session ID (auto-managed, usually not needed)'
        },
        x: { type: 'number', description: 'X coordinate for click' },
        y: { type: 'number', description: 'Y coordinate for click' },
        coordinate_origin: { 
          type: 'string', 
          enum: ['viewport', 'lux_sdk'],
          description: 'Coordinate system: viewport (pixels) or lux_sdk (from Lux Actor)'
        },
        click_type: { 
          type: 'string', 
          enum: ['single', 'double', 'right'],
          description: 'Click type (default: single)'
        },
        text: { type: 'string', description: 'Text to type' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Scroll amount in pixels (default: 500)' },
        keys: { type: 'string', description: 'Keys to press (e.g., "Enter", "Control+A")' },
        start_url: { type: 'string', description: 'Initial URL for browser_start' },
        url: { type: 'string', description: 'URL for browser_navigate' }
      },
      required: ['action']
    }
  },
  {
    name: 'lux_actor_vision',
    description: `Locate elements visually using Lux Actor API (cloud).
FAST (~1 second). Best for:
- Finding buttons, links, input fields
- Desktop apps and standard UI
- Repetitive actions where speed matters

Returns coordinates in 'lux_sdk' system.
Use with: tool_server_action click + coordinate_origin="lux_sdk"

Example: After screenshot, call this with target="Compose button" to get coordinates.`,
    input_schema: {
      type: 'object',
      properties: {
        screenshot: { 
          type: 'string', 
          description: 'Screenshot in base64 (from tool_server_action screenshot, use lux_optimized.image_base64)'
        },
        target: { 
          type: 'string', 
          description: 'Description of element to find (e.g., "blue Compose button", "search input field")'
        }
      },
      required: ['screenshot', 'target']
    }
  },
  {
    name: 'gemini_computer_use',
    description: `Locate elements using Gemini Vision API.
SLOWER (~2-3 seconds) but SMARTER. Best for:
- Modern web apps with complex UI
- Elements requiring contextual reasoning
- When lux_actor_vision fails to find element
- Ambiguous UI where reasoning helps

Returns coordinates in 'viewport' system.
Use with: tool_server_action click + coordinate_origin="viewport"`,
    input_schema: {
      type: 'object',
      properties: {
        screenshot: { 
          type: 'string', 
          description: 'Screenshot in base64'
        },
        target: { 
          type: 'string', 
          description: 'Description of element to find'
        },
        context: { 
          type: 'string', 
          description: 'Additional context (e.g., "in the top toolbar", "inside the modal dialog")'
        }
      },
      required: ['screenshot', 'target']
    }
  }
];

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
    // Check connection first
    const isConnected = await checkConnection();
    if (!isConnected) {
      setState(prev => ({
        ...prev,
        error: 'Tool Server non raggiungibile. Verifica che sia in esecuzione su http://127.0.0.1:8766'
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
                current_session_id: sessionManager.sessionId
              }
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

          console.log(`📤 Tool result:`, toolResult.is_error ? 'ERROR' : 'SUCCESS');

          // Capture session_id if present
          if (
            typeof toolResult.content === 'object' &&
            toolResult.content !== null &&
            'session_id' in toolResult.content
          ) {
            sessionManager.captureFromToolResult(toolResult.content as Record<string, unknown>);
          }

          // Add tool result to history (as user message per Anthropic format)
          conversationHistory.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolResult.tool_use_id,
              content: typeof toolResult.content === 'string' 
                ? toolResult.content 
                : JSON.stringify(toolResult.content),
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
