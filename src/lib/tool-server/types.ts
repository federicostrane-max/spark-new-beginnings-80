// ============================================================
// TYPES - Tool Server Integration
// ============================================================

export interface ToolServerConfig {
  baseUrl: string;
  timeout: number;
}

export const DEFAULT_CONFIG: ToolServerConfig = {
  baseUrl: 'http://127.0.0.1:8766',
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
  
  // Per click
  // Tool Server v8.4.1: viewport = lux_sdk (1:1 mapping)
  // 'normalized' is for Gemini raw 0-999 coordinates
  x?: number;
  y?: number;
  coordinate_origin?: 'viewport' | 'lux_sdk' | 'normalized';
  click_type?: 'single' | 'double' | 'right';
  
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
  test_id?: string;
  label?: string;
  placeholder?: string;
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
