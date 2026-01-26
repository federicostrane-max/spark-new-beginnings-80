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
  // CLAWDBOT: Browser Automation (Primary - use this for web!)
  // ════════════════════════════════════════════════════════
  {
    name: 'clawdbot_action',
    description: `🌐 PRIMARY TOOL FOR WEB AUTOMATION - Uses Clawdbot Service (port 8767).

AVAILABLE ACTIONS:
- navigate: Go to a URL
- snapshot: Get page DOM with ref IDs for AI interaction (use mode="ai")
- click: Click element by ref ID (e.g., ref="e3")
- type: Type text into element (requires ref + text)
- hover: Hover over element by ref
- scroll: Scroll element into view by ref
- select: Select dropdown option by ref + values
- press: Press keyboard key (Enter, Tab, Escape, etc.)
- drag: Drag from one ref to another ref
- wait: Wait for time/text/selector/url
- screenshot: Take screenshot (fullPage optional)
- evaluate: Execute JavaScript in page
- upload: Upload files

RECOMMENDED WORKFLOW:
1. navigate → go to URL
2. snapshot → get DOM with ref IDs
3. click/type → interact using refs (e.g., click ref="e5")
4. snapshot → verify result

IMPORTANT:
- Always get a snapshot first to see available refs!
- Refs are like "e1", "e2", "e3" - short identifiers for elements
- This tool is async: returns task_id, then poll for result`,
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'snapshot', 'click', 'type', 'hover', 'scroll', 'select',
                 'press', 'drag', 'wait', 'screenshot', 'evaluate', 'upload'],
          description: 'Action to execute'
        },
        // Navigation
        url: { type: 'string', description: 'URL for navigate action' },
        // Element interaction (most actions use ref)
        ref: { type: 'string', description: 'Element ref ID from snapshot (e.g., "e3")' },
        text: { type: 'string', description: 'Text to type (for type action)' },
        submit: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
        // Click options
        doubleClick: { type: 'boolean', description: 'Double click (default: false)' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
        // Select options
        values: { type: 'array', items: { type: 'string' }, description: 'Values to select (for select action)' },
        // Press options
        key: { type: 'string', description: 'Key to press (e.g., "Enter", "Tab", "Escape")' },
        // Drag options
        from: { type: 'string', description: 'Source ref for drag' },
        to: { type: 'string', description: 'Target ref for drag' },
        // Wait options
        timeMs: { type: 'number', description: 'Wait time in milliseconds' },
        selector: { type: 'string', description: 'CSS selector to wait for' },
        waitText: { type: 'string', description: 'Text to wait for on page' },
        loadState: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Page load state to wait for' },
        // Snapshot options
        mode: { type: 'string', enum: ['ai', 'aria'], description: 'Snapshot mode (default: ai)' },
        // Screenshot options
        fullPage: { type: 'boolean', description: 'Capture full page (default: false)' },
        // Evaluate options
        script: { type: 'string', description: 'JavaScript to execute' },
        // Upload options
        files: { type: 'array', items: { type: 'string' }, description: 'File paths to upload' }
      },
      required: ['action']
    }
  },

  // ════════════════════════════════════════════════════════
  // TOOL SERVER: Desktop Actions Only (fallback)
  // ════════════════════════════════════════════════════════
  {
    name: 'tool_server_action',
    description: `🖥️ DESKTOP AUTOMATION ONLY - Use for non-browser desktop apps.
For web/browser automation, use clawdbot_action instead!

This tool controls the desktop via pyautogui (coordinates-based).
Use scope="desktop" for all actions.

AVAILABLE ACTIONS:
- screenshot: Capture desktop screen
- click: Click at coordinates (x, y) on desktop
- type: Type text (desktop level)
- scroll: Scroll at current position
- keypress: Press keys (desktop level)
- hold_key: Hold a key for duration

WHEN TO USE:
- Interacting with native desktop apps (not in browser)
- When you need coordinate-based clicking on desktop`,
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['screenshot', 'click', 'type', 'scroll', 'keypress', 'hold_key'],
          description: 'Action to execute'
        },
        scope: {
          type: 'string',
          enum: ['desktop'],
          description: 'Must be "desktop" for this tool'
        },
        x: { type: 'number', description: 'X coordinate for click' },
        y: { type: 'number', description: 'Y coordinate for click' },
        click_type: {
          type: 'string',
          enum: ['single', 'double', 'right', 'triple'],
          description: 'Click type (default: single)'
        },
        text: { type: 'string', description: 'Text to type' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Scroll amount in pixels (default: 500)' },
        keys: { type: 'string', description: 'Keys to press (e.g., "Enter", "Control+A")' },
        duration: { type: 'number', description: 'Duration in seconds for hold_key' }
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
          console.log(`🔍 [useToolServerAgent] Tool result content type:`, typeof toolResult.content);
          console.log(`🔍 [useToolServerAgent] Tool result content:`, toolResult.content);
          console.log(`🔍 [useToolServerAgent] Current sessionManager.sessionId BEFORE capture:`, sessionManager.sessionId);

          if (
            typeof toolResult.content === 'object' &&
            toolResult.content !== null &&
            'session_id' in toolResult.content
          ) {
            console.log(`🔍 [useToolServerAgent] Found session_id in result:`, (toolResult.content as Record<string, unknown>).session_id);
            sessionManager.captureFromToolResult(toolResult.content as Record<string, unknown>);
            console.log(`🔍 [useToolServerAgent] sessionManager.sessionId AFTER capture:`, sessionManager.sessionId);
          } else {
            console.log(`🔍 [useToolServerAgent] No session_id in result`);
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
