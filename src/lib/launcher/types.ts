/**
 * Claude Launcher Desktop App API Types
 */

// ============================================================
// Session Types
// ============================================================

export interface TerminalSession {
  id: string;
  projectPath: string;
  projectName: string;
  sessionName?: string;
  folderName?: string;
  status: 'idle' | 'thinking' | 'running';
  launchedAt: number;
}

export interface SessionMetadata {
  sessionId: string;
  title?: string;
  tags?: string[];
  topics?: string[];
  summary?: string;
  lastAnalyzed?: number;
}

export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface SessionSearchResult {
  sessionId: string;
  folderName: string;
  projectPath?: string;
  title?: string;
  firstPrompt?: string;
  lastModified?: number;
  matchedIn: 'title' | 'content' | 'both';
  matchSnippet?: string;
}

// ============================================================
// Orchestration Types
// ============================================================

export interface OrchestrationStatus {
  activeSessions: number;
  idleSessions: number;
  thinkingSessions: number;
  totalMessageCount: number;
  lastActivity: number;
  sessions: Array<{
    id: string;
    projectPath: string;
    status: string;
    lastOutput?: number;
  }>;
}

export type OrchestrationEventType =
  | 'session_created'
  | 'session_ended'
  | 'session_output'
  | 'session_ready'
  | 'heartbeat';

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  timestamp: number;
  sessionId?: string;
  data?: unknown;
}

// ============================================================
// Webhook Types
// ============================================================

export type WebhookEventType =
  | 'session_created'
  | 'session_ended'
  | 'session_ready'
  | 'message_received'
  | 'message_count'
  | 'error'
  | 'question_asked';

export interface WebhookConfig {
  id: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  secret?: string;
  createdAt: number;
  lastTriggered?: number;
  failureCount: number;
  metadata?: {
    name?: string;
    description?: string;
    messageCountThreshold?: number;
  };
}

// ============================================================
// API Response Types
// ============================================================

export interface ApiDocsResponse {
  version: string;
  endpoints: Array<{
    method: string;
    path: string;
    description: string;
  }>;
}

export interface SearchResponse {
  results: SessionSearchResult[];
  total: number;
  query: string;
}

export interface SessionMessagesResponse {
  sessionId: string;
  messages: ParsedMessage[];
  total: number;
}

export interface BulkMetadataResponse {
  metadata: Record<string, SessionMetadata>;
  count: number;
}

export interface RestartResponse {
  success: boolean;
  message?: string;
  workspaceId?: string;
}

export interface BroadcastResponse {
  sent: number;
  failed: number;
}

export interface SessionsListResponse {
  sessions: TerminalSession[];
  count: number;
}

export interface CreateSessionResponse {
  session: TerminalSession;
  success: boolean;
}

export interface SendMessageResponse {
  success: boolean;
  sessionId: string;
  messageId?: string;
}

export interface WebhooksListResponse {
  webhooks: WebhookConfig[];
  count: number;
}

// ============================================================
// Additional Response Types
// ============================================================

export interface HealthCheckResponse {
  healthy: boolean;
  version?: string;
  uptime?: number;
}

export interface TestWebhookResponse {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

export interface AnswerQuestionResponse {
  success: boolean;
  sessionId: string;
}

export interface GetSessionResponse {
  session: TerminalSession;
}

export interface UpdateWebhookResponse {
  webhook: WebhookConfig;
  success: boolean;
}
