// ============================================================
// ORCHESTRATOR TYPES - Multi-Agent Orchestrator System
// ============================================================

// Configuration
export interface OrchestratorConfig {
  maxRetries: number;
  maxSteps: number;
  loopDetectionThreshold: number;
  confidenceThreshold: number;
  luxTimeout: number;
  geminiTimeout: number;
  plannerTimeout: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxRetries: 3,
  maxSteps: 20,
  loopDetectionThreshold: 3,
  confidenceThreshold: 0.5,
  luxTimeout: 10000,
  geminiTimeout: 15000,
  plannerTimeout: 30000,
};

// Plan Types (output from Planner Agent)
export interface PlanStep {
  step_number: number;
  action_type: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'keypress';
  target_description: string;
  input_value?: string;
  fallback_description?: string;
  expected_outcome?: string;
}

export interface Plan {
  analysis: string;
  goal: string;
  steps: PlanStep[];
  success_criteria: string;
}

// Vision Result Types
export interface VisionResult {
  found: boolean;
  x: number | null;
  y: number | null;
  confidence: number;
  coordinate_system: 'lux_sdk' | 'viewport';
  reasoning?: string;
}

// Step Execution Tracking
export interface StepExecution {
  step: PlanStep;
  vision_result: VisionResult | null;
  action_result: { success: boolean; error?: string } | null;
  success: boolean;
  retries: number;
  used_fallback: boolean;
  duration_ms: number;
  screenshot_before?: string;
  screenshot_after?: string;
}

// Orchestrator State
export type OrchestratorStatus = 
  | 'idle'
  | 'initializing'
  | 'planning'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'loop_detected';

export interface OrchestratorState {
  task: string;
  session_id: string | null;
  current_url: string | null;
  plan: Plan | null;
  current_step_index: number;
  executed_steps: StepExecution[];
  status: OrchestratorStatus;
  error?: string;
  started_at: number | null;
  completed_at: number | null;
}

// Action Record for Loop Detection and Caching
export interface ActionRecord {
  timestamp: number;
  action_type: string;
  target_description: string;
  x: number | null;
  y: number | null;
  url: string;
  success: boolean;
}

// Cached Coordinate Entry
export interface CachedCoordinate {
  x: number;
  y: number;
  coordinate_system: 'lux_sdk' | 'viewport';
  success_count: number;
  last_used: number;
  url: string;
}

// Log Entry
export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

// Callbacks for UI updates
export interface OrchestratorCallbacks {
  onStateChange?: (state: OrchestratorState) => void;
  onLog?: (entry: LogEntry) => void;
  onStepStart?: (step: PlanStep, index: number) => void;
  onStepComplete?: (execution: StepExecution, index: number) => void;
  onPlanCreated?: (plan: Plan) => void;
}
