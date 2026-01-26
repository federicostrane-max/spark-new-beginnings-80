// ============================================================
// TYPES - Tool Server Integration
// ============================================================

export interface ToolServerConfig {
  baseUrl: string;
  timeout: number;
}

export const DEFAULT_CONFIG: ToolServerConfig = {
  baseUrl: import.meta.env.VITE_TOOL_SERVER_URL || 'http://127.0.0.1:8766',
  timeout: 30000
};

// ============================================================
// Tool Server Actions
// ============================================================

export type ToolServerActionType =
  | 'browser_start'
  | 'browser_stop'
  | 'browser_navigate'
  | 'screenshot'
  | 'dom_tree'
  | 'click'
  | 'click_by_ref'
  | 'type'
  | 'scroll'
  | 'keypress'
  | 'element_rect'
  | 'browser_element_rect';

export interface ToolServerActionInput {
  action: ToolServerActionType;
  scope?: 'browser' | 'desktop';
  session_id?: string;

  // Per browser_start
  start_url?: string;

  // Per click (coordinate-based)
  // Tool Server v8.4.1: viewport = lux_sdk (1:1 mapping)
  // 'normalized' is for Gemini raw 0-999 coordinates
  x?: number;
  y?: number;
  coordinate_origin?: 'viewport' | 'lux_sdk' | 'normalized';
  click_type?: 'single' | 'double' | 'right';

  // Per click_by_ref (ref-based from dom_tree snapshot)
  ref?: string;  // e.g., "e3" from dom_tree output

  // Per type
  text?: string;

  // Per scroll
  direction?: 'up' | 'down';
  amount?: number;

  // Per keypress
  keys?: string;

  // Per browser_navigate
  url?: string;

  // Per element_rect (DOM element search)
  selector?: string;
  role?: string;
  role_name?: string;       // Accessible name for role-based lookup
  test_id?: string;
  label?: string;
  placeholder?: string;
  text_exact?: boolean;     // Exact text match (default: false)
  index?: number;           // nth element matching (default: 0)
  must_be_visible?: boolean; // Filter for visible only (default: true)

  // v10.1.0: Auto-snapshot DOM after action
  include_snapshot?: boolean;
}

export interface ToolServerResponse {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

// ============================================================
// Vision Tool Types
// ============================================================

export interface LuxActorInput {
  screenshot: string;  // base64
  target: string;
}

export interface LuxActorResult {
  success: boolean;
  x?: number;
  y?: number;
  confidence?: number;
  coordinate_system: 'lux_sdk';
  error?: string;
}

export interface GeminiVisionInput {
  screenshot: string;  // base64
  target: string;
  context?: string;
}

export interface GeminiVisionResult {
  success: boolean;
  x?: number;
  y?: number;
  confidence?: number;
  reasoning?: string;
  coordinate_system: 'viewport';
  error?: string;
}

// ============================================================
// Agent Types
// ============================================================

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string | Record<string, unknown>;
  is_error?: boolean;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | ToolResult[];
}

// ============================================================
// Clawdbot Action Types
// ============================================================

export type ClawdbotActionType =
  | 'navigate'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'hover'
  | 'scroll'
  | 'select'
  | 'press'
  | 'drag'
  | 'wait'
  | 'screenshot'
  | 'evaluate'
  | 'upload';

export interface ClawdbotActionInput {
  action: ClawdbotActionType;

  // Navigation
  url?: string;

  // Element interaction
  ref?: string;
  text?: string;
  submit?: boolean;

  // Click options
  doubleClick?: boolean;
  button?: 'left' | 'right' | 'middle';

  // Select options
  values?: string[];

  // Press options
  key?: string;

  // Drag options
  from?: string;
  to?: string;

  // Wait options
  timeMs?: number;
  selector?: string;
  waitText?: string;
  loadState?: 'load' | 'domcontentloaded' | 'networkidle';

  // Snapshot options
  mode?: 'ai' | 'aria';

  // Screenshot options
  fullPage?: boolean;

  // Evaluate options
  script?: string;

  // Upload options
  files?: string[];
}
