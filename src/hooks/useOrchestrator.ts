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
} from '@/lib/tool-server/orchestrator-types';

export interface UseOrchestratorReturn {
  // State
  state: OrchestratorState;
  logs: LogEntry[];
  isRunning: boolean;
  isIdle: boolean;
  
  // Actions
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

  const executeTask = useCallback(async (task: string, startUrl?: string) => {
    setLogs([]);
    
    const orchestrator = createOrchestrator(config, {
      onStateChange: (newState) => {
        setState(newState);
      },
      onLog: (entry) => {
        setLogs(prev => [...prev, entry]);
      },
      onPlanCreated: (plan: Plan) => {
        console.log('[Orchestrator] Plan created:', plan);
      },
      onStepStart: (step: PlanStep, index: number) => {
        console.log(`[Orchestrator] Starting step ${index + 1}:`, step);
      },
      onStepComplete: (execution: StepExecution, index: number) => {
        console.log(`[Orchestrator] Completed step ${index + 1}:`, execution);
      },
    });

    orchestratorRef.current = orchestrator;

    try {
      await orchestrator.executeTask(task, startUrl);
    } catch (error) {
      console.error('[Orchestrator] Error:', error);
    }
  }, [config]);

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
    executeTask,
    abort,
    reset,
    progress,
    currentStep,
    completedSteps,
    totalSteps,
  };
}
