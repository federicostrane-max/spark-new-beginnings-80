// ============================================================
// TYPES - Desktop Automation with Lux API
// ============================================================

// Lux Action Types (from Lux API specification)
export type LuxActionType = 
  | 'click'
  | 'type'
  | 'scroll'
  | 'press'
  | 'wait'
  | 'done'
  | 'fail';

export interface LuxAction {
  type: LuxActionType;
  coordinate?: [number, number];  // [x, y] in lux_sdk coordinate space (1260x700)
  text?: string;                  // For 'type' action
  key?: string;                   // For 'press' action (e.g., 'Enter', 'Tab', 'Escape')
  direction?: 'up' | 'down';      // For 'scroll' action
  scroll_amount?: number;         // Scroll amount in pixels
  duration_ms?: number;           // For 'wait' action
  reason?: string;                // For 'done' or 'fail' actions
}

// Response from Lux API
export interface LuxApiResponse {
  actions: LuxAction[];
  is_done: boolean;
  reasoning?: string;
  error?: string;
}

// Lux Mode (matching database lux_mode_config)
export type LuxMode = 'actor' | 'thinker' | 'tasker';

// Configuration per mode
export interface LuxModeConfig {
  model: string;          // 'lux-actor-1' or 'lux-thinker-1'
  max_steps: number;      // Max steps for actor/thinker modes
  max_steps_per_todo: number;  // Max steps per todo for tasker mode
  temperature: number;    // API temperature (0.0 - 1.0)
}

export const LUX_MODE_CONFIGS: Record<LuxMode, LuxModeConfig> = {
  actor: {
    model: 'lux-actor-1',
    max_steps: 20,
    max_steps_per_todo: 20,
    temperature: 0.1
  },
  thinker: {
    model: 'lux-thinker-1',
    max_steps: 100,
    max_steps_per_todo: 100,
    temperature: 0.5
  },
  tasker: {
    model: 'lux-actor-1',
    max_steps: 200,  // Total across all todos
    max_steps_per_todo: 24,
    temperature: 0.0
  }
};

// Task configuration from SSE command
export interface DesktopTaskConfig {
  mode: LuxMode;
  task_description: string;
  todos?: string[];
  start_url?: string;
  config: {
    model: string;
    max_steps?: number;
    max_steps_per_todo: number;
    temperature: number;
  };
}

// Callbacks for real-time UI updates
export interface DesktopTaskCallbacks {
  onStep?: (stepIndex: number, action: LuxAction, screenshot?: string) => void;
  onTodoStart?: (todoIndex: number, todoDescription: string) => void;
  onTodoComplete?: (todoIndex: number, todoDescription: string, success: boolean) => void;
  onLog?: (message: string, level?: 'info' | 'warn' | 'error' | 'success') => void;
  onComplete?: (result: DesktopTaskResult) => void;
  onError?: (error: string) => void;
  onScreenshot?: (screenshot: string) => void;
}

// Execution result
export interface DesktopTaskResult {
  success: boolean;
  message: string;
  mode: LuxMode;
  stepsExecuted: number;
  todosCompleted?: number;
  totalTodos?: number;
  actionsLog: LuxAction[];
  duration_ms: number;
  error?: string;
}

// Step execution record
export interface DesktopStepExecution {
  stepIndex: number;
  todoIndex?: number;
  action: LuxAction;
  screenshot_before?: string;
  screenshot_after?: string;
  success: boolean;
  error?: string;
  duration_ms: number;
}

// Desktop Tool Server response
export interface DesktopToolServerResponse {
  success: boolean;
  error?: string;
  screenshot?: string;
  [key: string]: unknown;
}
