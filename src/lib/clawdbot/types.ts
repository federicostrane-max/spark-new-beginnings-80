/**
 * Clawdbot Service Types
 *
 * Type definitions for the Clawdbot browser automation service.
 * Used by both direct connections (port 8767) and via Tool Server proxy.
 */

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ClawdbotTask {
  task_id: string;
  status: TaskStatus;
  created_at: string;
}

export interface TaskMessage {
  id: number;
  timestamp: string;
  type: 'info' | 'action' | 'error' | 'success' | 'screenshot';
  text: string;
}

export interface ClawdbotTaskResult {
  task_id: string;
  status: TaskStatus;
  messages: TaskMessage[];
  messages_since: number;
  result?: unknown;
  error?: string;
}

// ============================================================================
// Action Types
// ============================================================================

export type ClawdbotAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'hover'
  | 'scroll'
  | 'select'
  | 'screenshot'
  | 'snapshot'
  | 'wait'
  | 'press'
  | 'drag'
  | 'cookies_get'
  | 'cookies_set'
  | 'storage_get'
  | 'storage_set'
  | 'upload'
  | 'evaluate';

// ============================================================================
// Action Parameters
// ============================================================================

export interface NavigateParams {
  url: string;
  targetId?: string;
  [key: string]: unknown;
}

export interface ClickParams {
  ref: string;
  targetId?: string;
  doubleClick?: boolean;
  button?: 'left' | 'right' | 'middle';
  [key: string]: unknown;
}

export interface TypeParams {
  ref: string;
  text: string;
  targetId?: string;
  submit?: boolean;
  slowly?: boolean;
  [key: string]: unknown;
}

export interface HoverParams {
  ref: string;
  targetId?: string;
  [key: string]: unknown;
}

export interface ScrollParams {
  ref: string;
  targetId?: string;
  [key: string]: unknown;
}

export interface SelectParams {
  ref: string;
  values: string[];
  targetId?: string;
  [key: string]: unknown;
}

export interface ScreenshotParams {
  targetId?: string;
  fullPage?: boolean;
  selector?: string;
  [key: string]: unknown;
}

export interface SnapshotParams {
  mode?: 'ai' | 'aria';
  targetId?: string;
  limit?: number;
  maxChars?: number;
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
  selector?: string;
  labels?: boolean;
  [key: string]: unknown;
}

export interface WaitParams {
  timeMs?: number;
  text?: string;
  selector?: string;
  url?: string;
  loadState?: 'load' | 'domcontentloaded' | 'networkidle';
  [key: string]: unknown;
}

export interface PressParams {
  key: string;
  targetId?: string;
  delayMs?: number;
  [key: string]: unknown;
}

export interface DragParams {
  from: string;
  to: string;
  targetId?: string;
  [key: string]: unknown;
}

export interface StorageParams {
  type: 'local' | 'session';
  targetId?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UploadParams {
  files: string[];
  ref?: string;
  targetId?: string;
  [key: string]: unknown;
}

export interface EvaluateParams {
  script: string;
  ref?: string;
  targetId?: string;
  [key: string]: unknown;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface TaskRequest {
  action: ClawdbotAction;
  params: Record<string, unknown>;
  timeout_ms?: number;
  claude_launcher?: ClaudeLauncherConfig;
}

export interface ClaudeLauncherConfig {
  api_url: string;
  api_token: string;
  session_id: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  browser_connected: boolean;
  active_tasks: number;
}

export interface TaskListResponse {
  tasks: Array<{
    id: string;
    status: TaskStatus;
    action: ClawdbotAction;
    created_at: string;
    completed_at?: string;
  }>;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type WebSocketMessageType = 'message' | 'completed' | 'failed' | 'cancelled';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  data: TaskMessage | { result?: unknown } | { error?: string } | Record<string, never>;
}

// ============================================================================
// Snapshot Result Types
// ============================================================================

export interface SnapshotResult {
  snapshot: string;
  stats?: {
    refs?: number;
    chars?: number;
  };
}

export interface ScreenshotResult {
  image: string; // base64
  width: number;
  height: number;
}
