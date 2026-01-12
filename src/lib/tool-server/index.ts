// ============================================================
// Tool Server Library - Public Exports
// ============================================================

// Core client and utilities
export { toolServerClient, ToolServerClient } from './client';
export { executeToolUse } from './tool-executor';
export { sessionManager } from './session-manager';

// Orchestrator
export { Orchestrator, createOrchestrator } from './orchestrator';
export { LoopDetector } from './loop-detector';
export { ActionCache } from './action-cache';
export { BROWSER_ORCHESTRATOR_CONFIG, BROWSER_PLANNING_INSTRUCTIONS } from './agent-prompts';

// Types - Tool Server
export type {
  ToolServerConfig,
  ToolServerActionType,
  ToolServerActionInput,
  ToolServerResponse,
  LuxActorInput,
  LuxActorResult,
  GeminiVisionInput,
  GeminiVisionResult,
  ToolUse,
  ToolResult,
  AgentMessage,
} from './types';

// Types - Orchestrator
export type {
  OrchestratorConfig,
  OrchestratorState,
  OrchestratorStatus,
  OrchestratorCallbacks,
  Plan,
  PlanStep,
  VisionResult,
  StepExecution,
  ActionRecord,
  CachedCoordinate,
  LogEntry,
  LogLevel,
} from './orchestrator-types';

export { DEFAULT_ORCHESTRATOR_CONFIG } from './orchestrator-types';
