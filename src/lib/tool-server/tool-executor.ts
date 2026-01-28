// ============================================================
// Tool Executor - Esegue tool nel frontend
// CRITICAL: Blocca azioni locali se Tool Server non configurato
// ============================================================

import { toolServerClient } from './client';
import { supabase } from '@/integrations/supabase/client';
import { ClawdbotClient } from '@/lib/clawdbot';
import { getLauncherClient } from '@/lib/launcher';
import type {
  ToolUse,
  ToolResult,
  ToolServerActionInput,
  ClawdbotActionInput,
  LuxActorInput,
  GeminiVisionInput,
} from './types';

// ──────────────────────────────────────────────────────────
// PM Tool Input Types
// ──────────────────────────────────────────────────────────

interface DesktopApiCallInput {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

interface DesktopCreateSessionInput {
  projectPath: string;
  sessionType?: 'new' | 'resume';
  sessionName?: string;
}

interface DesktopSendMessageInput {
  sessionId: string;
  message: string;
  files?: string[];
}

interface DesktopSearchSessionsInput {
  query: string;
  limit?: number;
}

interface KnowledgeReadInput {
  category?: string;
  search?: string;
  limit?: number;
}

interface KnowledgeWriteInput {
  category: string;
  title: string;
  content: string;
  tags?: string[];
}

interface SessionMetadataGetInput {
  sessionId: string;
}

interface SessionMetadataUpdateInput {
  sessionId: string;
  title?: string;
  tags?: string[];
  topics?: string[];
  summary?: string;
}

interface FeatureRequestInput {
  description: string;
  priority?: 'low' | 'medium' | 'high';
  context?: Record<string, unknown>;
}

interface DesktopListSessionsInput {
  // No required params
}

interface DesktopGetSessionInput {
  sessionId: string;
}

interface DesktopGetSessionHistoryInput {
  sessionId: string;
  limit?: number;
}

interface DesktopAnswerQuestionInput {
  sessionId: string;
  answer: string;
}

interface FeatureRequestStatusInput {
  featureId: string;
}

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
      // CLAWDBOT: Browser Automation (PRIMARY for web!)
      // ════════════════════════════════════════════════════
      case 'clawdbot_action':
        if (!toolServerClient.isConfigured()) {
          console.warn('⛔ Tool Server non configurato, blocco azione Clawdbot:', input);
          result = {
            success: false,
            error: 'Tool Server non configurato. Apri le impostazioni (icona 🟡 in alto) e salva il tuo URL ngrok.',
          };
          break;
        }
        result = await executeClawdbotAction(input as unknown as ClawdbotActionInput);
        break;

      // ════════════════════════════════════════════════════
      // TOOL SERVER: Desktop Actions Only (fallback)
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
      // PM AGENT: Desktop App Integration
      // ════════════════════════════════════════════════════
      case 'desktop_api_call':
        result = await executeDesktopApiCall(input as unknown as DesktopApiCallInput);
        break;

      case 'desktop_create_session':
        result = await executeDesktopCreateSession(input as unknown as DesktopCreateSessionInput);
        break;

      case 'desktop_send_message':
        result = await executeDesktopSendMessage(input as unknown as DesktopSendMessageInput);
        break;

      case 'desktop_search_sessions':
        result = await executeDesktopSearchSessions(input as unknown as DesktopSearchSessionsInput);
        break;

      case 'desktop_get_orchestration_status':
        result = await executeDesktopGetOrchestrationStatus();
        break;

      case 'desktop_restart':
        result = await executeDesktopRestart();
        break;

      case 'desktop_list_sessions':
        result = await executeDesktopListSessions();
        break;

      case 'desktop_get_session':
        result = await executeDesktopGetSession(input as unknown as DesktopGetSessionInput);
        break;

      case 'desktop_get_session_history':
        result = await executeDesktopGetSessionHistory(input as unknown as DesktopGetSessionHistoryInput);
        break;

      case 'desktop_answer_question':
        result = await executeDesktopAnswerQuestion(input as unknown as DesktopAnswerQuestionInput);
        break;

      // ════════════════════════════════════════════════════
      // PM AGENT: Knowledge Base (Supabase)
      // ════════════════════════════════════════════════════
      case 'knowledge_read':
        result = await executeKnowledgeRead(input as unknown as KnowledgeReadInput);
        break;

      case 'knowledge_write':
        result = await executeKnowledgeWrite(input as unknown as KnowledgeWriteInput);
        break;

      // ════════════════════════════════════════════════════
      // PM AGENT: Session Metadata
      // ════════════════════════════════════════════════════
      case 'session_metadata_get':
        result = await executeSessionMetadataGet(input as unknown as SessionMetadataGetInput);
        break;

      case 'session_metadata_update':
        result = await executeSessionMetadataUpdate(input as unknown as SessionMetadataUpdateInput);
        break;

      // ════════════════════════════════════════════════════
      // PM AGENT: Feature Requests
      // ════════════════════════════════════════════════════
      case 'feature_request':
        result = await executeFeatureRequest(input as unknown as FeatureRequestInput);
        break;

      case 'feature_request_status':
        result = await executeFeatureRequestStatus(input as unknown as FeatureRequestStatusInput);
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
// PM Agent: Desktop App Handlers
// ──────────────────────────────────────────────────────────

async function executeDesktopApiCall(input: DesktopApiCallInput): Promise<Record<string, unknown>> {
  const client = getLauncherClient();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  const token = client.getToken();
  if (token) {
    headers['X-API-Token'] = token;
  }

  const response = await fetch(`${client.getBaseUrl()}${input.path}`, {
    method: input.method,
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  if (!response.ok) {
    return {
      success: false,
      error: `API error: ${response.status} ${response.statusText}`,
    };
  }

  const data = await response.json();
  return { success: true, data };
}

async function executeDesktopCreateSession(input: DesktopCreateSessionInput): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const session = await client.createSession(
      input.projectPath,
      input.sessionType || 'new',
      input.sessionName
    );
    return { success: true, session };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create session',
    };
  }
}

async function executeDesktopSendMessage(input: DesktopSendMessageInput): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    await client.sendMessage(input.sessionId, input.message, input.files);
    return { success: true, sessionId: input.sessionId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send message',
    };
  }
}

async function executeDesktopSearchSessions(input: DesktopSearchSessionsInput): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const results = await client.searchSessions(input.query, input.limit);
    return { success: true, results, count: results.length };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search sessions',
    };
  }
}

async function executeDesktopGetOrchestrationStatus(): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const status = await client.getOrchestrationStatus();
    return { success: true, ...status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get orchestration status',
    };
  }
}

async function executeDesktopRestart(): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    await client.restartDev();
    const result = await client.waitForRestart();
    return { success: result.success };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to restart',
    };
  }
}

async function executeDesktopListSessions(): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const sessions = await client.getSessions();
    return { success: true, sessions, count: sessions.length };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list sessions',
    };
  }
}

async function executeDesktopGetSession(input: DesktopGetSessionInput): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const session = await client.getSession(input.sessionId);
    return { success: true, session };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get session',
    };
  }
}

async function executeDesktopGetSessionHistory(input: DesktopGetSessionHistoryInput): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const messages = await client.getSessionMessages(input.sessionId, input.limit);
    return { success: true, messages, count: messages.length };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get session history',
    };
  }
}

async function executeDesktopAnswerQuestion(input: DesktopAnswerQuestionInput): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const result = await client.answerQuestion(input.sessionId, input.answer);
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to answer question',
    };
  }
}

// ──────────────────────────────────────────────────────────
// PM Agent: Knowledge Base Handlers
// ──────────────────────────────────────────────────────────

async function executeKnowledgeRead(input: KnowledgeReadInput): Promise<Record<string, unknown>> {
  try {
    let query = supabase
      .from('agent_knowledge')
      .select('*');

    if (input.category && input.category !== 'all') {
      query = query.eq('category', input.category);
    }

    if (input.search) {
      query = query.textSearch('content', input.search);
    }

    const { data, error } = await query
      .limit(input.limit || 10)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return { success: true, data, count: data?.length || 0 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read knowledge',
    };
  }
}

async function executeKnowledgeWrite(input: KnowledgeWriteInput): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await supabase
      .from('agent_knowledge')
      .insert({
        category: input.category,
        document_name: input.title,
        content: input.content,
        // Note: tags would need a separate column or JSONB field
      })
      .select()
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to write knowledge',
    };
  }
}

// ──────────────────────────────────────────────────────────
// PM Agent: Session Metadata Handlers
// ──────────────────────────────────────────────────────────

async function executeSessionMetadataGet(input: SessionMetadataGetInput): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const metadata = await client.getSessionMetadata(input.sessionId);
    return { success: true, metadata };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get session metadata',
    };
  }
}

async function executeSessionMetadataUpdate(input: SessionMetadataUpdateInput): Promise<Record<string, unknown>> {
  try {
    const client = getLauncherClient();
    const { sessionId, ...updateData } = input;
    const metadata = await client.updateSessionMetadata(sessionId, updateData);
    return { success: true, metadata };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update session metadata',
    };
  }
}

// ──────────────────────────────────────────────────────────
// PM Agent: Feature Request Handler
// ──────────────────────────────────────────────────────────

async function executeFeatureRequest(input: FeatureRequestInput): Promise<Record<string, unknown>> {
  // Note: feature_requests table would need to be created via migration
  // For now, return a mock success with a generated ID
  const featureId = crypto.randomUUID();
  
  console.log('[PM Agent] Feature request created:', {
    id: featureId,
    description: input.description,
    priority: input.priority,
    context: input.context,
  });

  return { 
    success: true, 
    featureId,
    message: 'Feature request recorded. Note: Database table not yet configured.',
  };
}

async function executeFeatureRequestStatus(input: FeatureRequestStatusInput): Promise<Record<string, unknown>> {
  // Note: feature_requests table would need to be created via migration
  // For now, return a mock status
  console.log('[PM Agent] Feature request status check:', input.featureId);

  return { 
    success: true, 
    featureId: input.featureId,
    status: 'pending',
    message: 'Feature request status check. Note: Database table not yet configured.',
  };
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

  // 🔍 DEBUG: Log dettagliato per ogni azione
  console.log(`🔍 [tool-executor] Action: ${input.action}`);
  console.log(`🔍 [tool-executor] Input session_id: ${input.session_id || 'not provided'}`);
  console.log(`🔍 [tool-executor] Current session_id: ${currentSessionId || 'not provided'}`);
  console.log(`🔍 [tool-executor] Using session_id: ${sessionId || 'NONE ⚠️'}`);
  console.log(`🔍 [tool-executor] Full input:`, input);

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

    case 'dom_tree': {
      if (!sessionId) throw new Error('session_id required for dom_tree');
      // Use text snapshot instead of full DOM tree - much better for LLM
      const snapshotResult = await toolServerClient.getSnapshot(sessionId);
      if (!snapshotResult.success) {
        return {
          success: false,
          error: snapshotResult.error || 'Failed to get DOM snapshot',
        };
      }
      // Return formatted for LLM consumption
      return {
        success: true,
        url: snapshotResult.url,
        title: snapshotResult.title,
        element_count: snapshotResult.ref_count,
        // This is the key: pass text snapshot, not JSON blob
        dom_structure: snapshotResult.snapshot,
        usage_hint: 'Use ref IDs (e.g., e3) with click_by_ref action, or use element_rect to find coordinates.',
      };
    }

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
        include_snapshot: input.include_snapshot ?? true,  // v10.1.0: Always include snapshot for agent awareness
      });

    case 'click_by_ref': {
      if (!sessionId) throw new Error('session_id required for click_by_ref');
      if (!input.ref) throw new Error('ref required for click_by_ref (e.g., "e3")');
      return toolServerClient.clickByRef({
        session_id: sessionId,
        ref: input.ref as string,
        click_type: input.click_type || 'single',
        include_snapshot: input.include_snapshot ?? true,  // v10.1.0: Always include snapshot for agent awareness
      });
    }

    case 'type':
      if (!input.text) throw new Error('text required for type');
      return toolServerClient.type({
        scope: input.scope || 'browser',
        text: input.text,
        session_id: sessionId,
        include_snapshot: input.include_snapshot ?? true,  // v10.1.0: Always include snapshot for agent awareness
      });

    case 'scroll':
      return toolServerClient.scroll({
        scope: input.scope || 'browser',
        direction: input.direction || 'down',
        amount: input.amount || 500,
        session_id: sessionId,
        include_snapshot: input.include_snapshot ?? true,  // v10.1.0: Always include snapshot for agent awareness
      });

    case 'keypress':
      if (!input.keys) throw new Error('keys required for keypress');
      return toolServerClient.keypress({
        scope: input.scope || 'browser',
        keys: input.keys,
        session_id: sessionId,
        include_snapshot: input.include_snapshot ?? true,  // v10.1.0: Always include snapshot for agent awareness
      });

    case 'element_rect':
    case 'browser_element_rect':
      if (!sessionId) throw new Error('session_id required for element_rect');
      return toolServerClient.getElementRect({
        session_id: sessionId,
        ref: input.ref,
        selector: input.selector,
        text: input.text,
        text_exact: input.text_exact,
        role: input.role,
        role_name: input.role_name,
        test_id: input.test_id,
        label: input.label,
        placeholder: input.placeholder,
        index: input.index,
        must_be_visible: input.must_be_visible,
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

// ──────────────────────────────────────────────────────────
// Clawdbot Action (via Tool Server proxy → port 8767)
// ──────────────────────────────────────────────────────────

async function executeClawdbotAction(input: ClawdbotActionInput): Promise<Record<string, unknown>> {
  const baseUrl = toolServerClient.getConfiguredUrl();
  const client = new ClawdbotClient(baseUrl, '', false); // Use proxy via Tool Server

  console.log(`🤖 [Clawdbot] Executing action: ${input.action}`, input);

  try {
    let task;

    switch (input.action) {
      case 'navigate':
        if (!input.url) throw new Error('url required for navigate');
        task = await client.navigate(input.url);
        break;

      case 'snapshot':
        task = await client.snapshot(input.mode || 'ai');
        break;

      case 'click':
        if (!input.ref) throw new Error('ref required for click (e.g., "e3")');
        task = await client.click(input.ref, {
          doubleClick: input.doubleClick,
          button: input.button,
        });
        break;

      case 'type':
        if (!input.ref) throw new Error('ref required for type');
        if (!input.text) throw new Error('text required for type');
        task = await client.type(input.ref, input.text, {
          submit: input.submit,
        });
        break;

      case 'hover':
        if (!input.ref) throw new Error('ref required for hover');
        task = await client.hover(input.ref);
        break;

      case 'scroll':
        if (!input.ref) throw new Error('ref required for scroll');
        task = await client.scroll(input.ref);
        break;

      case 'select':
        if (!input.ref) throw new Error('ref required for select');
        if (!input.values || input.values.length === 0) throw new Error('values required for select');
        task = await client.select(input.ref, input.values);
        break;

      case 'press':
        if (!input.key) throw new Error('key required for press (e.g., "Enter")');
        task = await client.press(input.key);
        break;

      case 'drag':
        if (!input.from || !input.to) throw new Error('from and to refs required for drag');
        task = await client.drag(input.from, input.to);
        break;

      case 'wait':
        if (input.timeMs) {
          task = await client.waitTime(input.timeMs);
        } else if (input.waitText) {
          task = await client.waitForText(input.waitText);
        } else if (input.selector) {
          task = await client.waitForSelector(input.selector);
        } else if (input.loadState) {
          task = await client.wait({ loadState: input.loadState });
        } else {
          throw new Error('wait requires timeMs, waitText, selector, or loadState');
        }
        break;

      case 'screenshot':
        task = await client.screenshot({ fullPage: input.fullPage });
        break;

      case 'evaluate':
        if (!input.script) throw new Error('script required for evaluate');
        task = await client.evaluate(input.script);
        break;

      case 'upload':
        if (!input.files || input.files.length === 0) throw new Error('files required for upload');
        task = await client.upload(input.files, input.ref);
        break;

      default:
        throw new Error(`Unknown Clawdbot action: ${input.action}`);
    }

    // Poll for task completion
    const result = await pollClawdbotTask(client, task.task_id);

    console.log(`✅ [Clawdbot] Action ${input.action} completed:`, result.status);

    if (result.status === 'failed') {
      return {
        success: false,
        error: result.error || 'Task failed',
        messages: result.messages,
      };
    }

    return {
      success: true,
      task_id: result.task_id,
      status: result.status,
      result: result.result,
      messages: result.messages,
    };

  } catch (error) {
    console.error(`❌ [Clawdbot] Error:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Clawdbot error',
    };
  }
}

/**
 * Poll Clawdbot task until completion
 */
async function pollClawdbotTask(
  client: ClawdbotClient,
  taskId: string,
  maxAttempts = 60,
  intervalMs = 500
): Promise<{
  task_id: string;
  status: string;
  messages: unknown[];
  result?: unknown;
  error?: string;
}> {
  let attempts = 0;
  let lastMessageId = 0;

  while (attempts < maxAttempts) {
    const result = await client.getTaskStatus(taskId, lastMessageId);

    if (result.status === 'completed' || result.status === 'failed' || result.status === 'cancelled') {
      return result;
    }

    // Track last message for incremental polling
    if (result.messages && result.messages.length > 0) {
      lastMessageId = result.messages_since;
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return {
    task_id: taskId,
    status: 'timeout',
    messages: [],
    error: `Task did not complete within ${maxAttempts * intervalMs}ms`,
  };
}
