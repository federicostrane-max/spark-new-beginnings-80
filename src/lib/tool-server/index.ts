// ============================================================
// Tool Server Library - Public Exports
// ============================================================
// Tool Server v8.4.1: viewport = lux_sdk (1260×700, 1:1 mapping)
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

// Constants (v8.4.1)
export { 
  VIEWPORT, 
  LUX_SDK, 
  NORMALIZED_COORD_MAX, 
  TRIPLE_VERIFY,
} from './constants';
export type { Confidence, RecommendedAction } from './constants';

// Coordinate utilities
export { 
  normalizedToViewport, 
  luxToViewport, 
  viewportToNormalized,
  distance, 
  isWithinViewport,
  clampToViewport,
  getCenterOfBox,
  averageCoordinates,
} from './coordinates';
export type { Coordinates } from './coordinates';

// Triple Verification
export { 
  tripleVerify, 
  coordinatesMatch,
  describePattern,
} from './triple-verify';
export type { 
  CoordinateSources, 
  TripleVerifyResult,
} from './triple-verify';

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
