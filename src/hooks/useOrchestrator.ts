// ============================================================
// useOrchestrator - React Hook for Multi-Agent Orchestrator
// ============================================================

import { useState, useCallback, useRef } from 'react';
import { 
  Orchestrator, 
  createOrchestrator 
} from '@/lib/tool-server/orchestrator';
import {
  OrchestratorState,
  OrchestratorConfig,
  LogEntry,
  Plan,
  PlanStep,
  StepExecution,
  DomForPlanningResult,
} from '@/lib/tool-server/orchestrator-types';

export interface UseOrchestratorReturn {
  // State
  state: OrchestratorState;
  logs: LogEntry[];
  isRunning: boolean;
  isIdle: boolean;
  
  // Actions
  /** Step 1: Get DOM tree for Agent to analyze and create plan */
  getDomForPlanning: (startUrl: string) => Promise<DomForPlanningResult>;
  /** Step 2: Execute the plan created by Agent */
  executePlan: (plan: Plan, startUrl?: string) => Promise<void>;
  /** @deprecated Use executePlan instead - plans now come from the Agent */
  executeTask: (task: string, startUrl?: string) => Promise<void>;
  abort: () => void;
  reset: () => void;
  
  // Computed
  progress: number;
  currentStep: PlanStep | null;
  completedSteps: number;
  totalSteps: number;
}

const initialState: OrchestratorState = {
  task: '',
  session_id: null,
  current_url: null,
  plan: null,
  current_step_index: -1,
  executed_steps: [],
  status: 'idle',
  started_at: null,
  completed_at: null,
};

export function useOrchestrator(
  config?: Partial<OrchestratorConfig>
): UseOrchestratorReturn {
  const [state, setState] = useState<OrchestratorState>(initialState);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const orchestratorRef = useRef<Orchestrator | null>(null);

  // ============================================================
  // Step 1: GET DOM FOR PLANNING
  // L'Agente chiama questo per ottenere la struttura del sito
  // prima di creare il piano
  // ============================================================
  const getDomForPlanning = useCallback(async (startUrl: string): Promise<DomForPlanningResult> => {
    setLogs([]);
    
    const orchestrator = createOrchestrator(config, {
      onStateChange: (newState) => setState(newState),
      onLog: (entry) => setLogs(prev => [...prev, entry]),
    });

    orchestratorRef.current = orchestrator;

    return await orchestrator.getDomForPlanning(startUrl);
  }, [config]);

  // ============================================================
  // Step 2: EXECUTE PLAN
  // L'Agente passa il piano creato dopo aver studiato DOM + KB
  // ============================================================
  const executePlan = useCallback(async (plan: Plan, startUrl?: string) => {
    // Don't reset logs if we already have them from getDomForPlanning
    if (logs.length === 0) {
      setLogs([]);
    }
    
    // Reuse existing orchestrator if available (from getDomForPlanning)
    const orchestrator = orchestratorRef.current || createOrchestrator(config, {
      onStateChange: (newState) => setState(newState),
      onLog: (entry) => setLogs(prev => [...prev, entry]),
      onPlanCreated: (p: Plan) => console.log('[Orchestrator] Plan received:', p),
      onStepStart: (step: PlanStep, index: number) => console.log(`[Orchestrator] Starting step ${index + 1}:`, step),
      onStepComplete: (execution: StepExecution, index: number) => console.log(`[Orchestrator] Completed step ${index + 1}:`, execution),
    });

    orchestratorRef.current = orchestrator;

    try {
      await orchestrator.executePlanFromCloud(plan, { startUrl });
    } catch (error) {
      console.error('[Orchestrator] Error:', error);
    }
  }, [config, logs.length]);

  // DEPRECATED: This now throws - use executePlan instead
  const executeTask = useCallback(async (_task: string, _startUrl?: string) => {
    console.warn('[Orchestrator] executeTask is deprecated. Use executePlan with a pre-built plan.');
    throw new Error('executeTask is deprecated. Plans should now be created by the Agent and passed to executePlan().');
  }, []);

  const abort = useCallback(() => {
    orchestratorRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    orchestratorRef.current?.abort();
    orchestratorRef.current = null;
    setState(initialState);
    setLogs([]);
  }, []);

  // Computed values
  const isRunning = ['initializing', 'planning', 'executing'].includes(state.status);
  const isIdle = state.status === 'idle';
  
  const totalSteps = state.plan?.steps.length || 0;
  const completedSteps = state.executed_steps.filter(e => e.success).length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  
  const currentStep = state.plan?.steps[state.current_step_index] || null;

  return {
    state,
    logs,
    isRunning,
    isIdle,
    getDomForPlanning,
    executePlan,
    executeTask,
    abort,
    reset,
    progress,
    currentStep,
    completedSteps,
    totalSteps,
  };
}
