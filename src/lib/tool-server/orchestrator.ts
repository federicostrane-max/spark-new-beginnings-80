// ============================================================
// ORCHESTRATOR - Multi-Agent Orchestrator with Deterministic Logic
// ============================================================

import { supabase } from '@/integrations/supabase/client';
import { toolServerClient } from './client';
import { sessionManager } from './session-manager';
import { LoopDetector } from './loop-detector';
import { ActionCache } from './action-cache';
import { PLANNER_AGENT_SYSTEM_PROMPT, PLANNER_AGENT_CONFIG } from './agent-prompts';
import {
  OrchestratorConfig,
  DEFAULT_ORCHESTRATOR_CONFIG,
  OrchestratorState,
  OrchestratorStatus,
  OrchestratorCallbacks,
  Plan,
  PlanStep,
  VisionResult,
  StepExecution,
  ActionRecord,
  LogEntry,
  LogLevel,
} from './orchestrator-types';

export class Orchestrator {
  private config: OrchestratorConfig;
  private state: OrchestratorState;
  private callbacks: OrchestratorCallbacks;
  private loopDetector: LoopDetector;
  private actionCache: ActionCache;
  private abortController: AbortController | null = null;
  private logs: LogEntry[] = [];

  constructor(
    config: Partial<OrchestratorConfig> = {},
    callbacks: OrchestratorCallbacks = {}
  ) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.callbacks = callbacks;
    this.loopDetector = new LoopDetector(this.config.loopDetectionThreshold);
    this.actionCache = new ActionCache();
    this.state = this.createInitialState();
  }

  private createInitialState(): OrchestratorState {
    return {
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
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  async executeTask(task: string, startUrl?: string): Promise<OrchestratorState> {
    this.abortController = new AbortController();
    this.state = this.createInitialState();
    this.state.task = task;
    this.state.started_at = Date.now();
    this.loopDetector.reset();
    this.logs = [];

    try {
      // Phase 1: Initialize Browser
      await this.initializeBrowser(startUrl);

      // Phase 2: Get DOM and Create Plan
      await this.createPlan();

      // Phase 3: Execute Plan
      await this.executePlan();

      // Phase 4: Finalize
      this.state.status = 'completed';
      this.state.completed_at = Date.now();
      this.log('success', 'Task completato con successo');

    } catch (error) {
      if (this.state.status === 'aborted') {
        this.log('warn', 'Task interrotto dall\'utente');
      } else {
        this.state.status = 'failed';
        this.state.error = error instanceof Error ? error.message : 'Unknown error';
        this.log('error', `Task fallito: ${this.state.error}`);
      }
    }

    this.notifyStateChange();
    return this.state;
  }

  abort(): void {
    this.state.status = 'aborted';
    this.abortController?.abort();
    this.notifyStateChange();
  }

  getState(): OrchestratorState {
    return { ...this.state };
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Execute a pre-generated plan from the cloud.
   * This method is used when the Planner Agent runs in the cloud and sends
   * the plan to the frontend for local execution via SSE tool_execute_locally.
   */
  async executePlanFromCloud(
    plan: Plan,
    options?: {
      sessionId?: string;
      startUrl?: string;
      navigation?: { action: string; params: Record<string, unknown> };
    }
  ): Promise<OrchestratorState> {
    this.abortController = new AbortController();
    this.state = this.createInitialState();
    this.state.task = plan.goal || 'Execute cloud-generated plan';
    this.state.plan = plan;
    this.state.started_at = Date.now();
    this.loopDetector.reset();
    this.logs = [];

    try {
      // Phase 1: Handle browser session
      if (options?.sessionId) {
        // Use existing session
        this.state.session_id = options.sessionId;
        sessionManager.captureFromToolResult({ session_id: options.sessionId });
        this.log('info', `Using existing session: ${options.sessionId.slice(0, 8)}...`);
      } else if (options?.startUrl) {
        // Start new browser
        await this.initializeBrowser(options.startUrl);
      } else if (options?.navigation) {
        // Execute navigation action first
        this.log('info', 'Executing initial navigation...');
        const navResult = await this.executeNavigationAction(options.navigation);
        if (!navResult.success) {
          throw new Error(`Navigation failed: ${navResult.error}`);
        }
      }

      // Phase 2: Execute the pre-generated plan
      this.callbacks.onPlanCreated?.(plan);
      this.log('success', `Executing cloud plan: ${plan.steps.length} steps`);
      this.log('info', `Goal: ${plan.goal}`);
      
      await this.executePlanSteps();

      // Phase 3: Finalize
      this.state.status = 'completed';
      this.state.completed_at = Date.now();
      this.log('success', 'Plan executed successfully');

    } catch (error) {
      if (this.state.status === 'aborted') {
        this.log('warn', 'Plan execution aborted by user');
      } else {
        this.state.status = 'failed';
        this.state.error = error instanceof Error ? error.message : 'Unknown error';
        this.log('error', `Plan execution failed: ${this.state.error}`);
      }
    }

    this.notifyStateChange();
    return this.state;
  }

  private async executeNavigationAction(
    navigation: { action: string; params: Record<string, unknown> }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      switch (navigation.action) {
        case 'browser_start':
          const startResult = await toolServerClient.browserStart(
            (navigation.params.start_url as string) || 'about:blank',
            { headless: navigation.params.headless as boolean }
          );
          if (startResult.success && startResult.session_id) {
            this.state.session_id = startResult.session_id;
            this.state.current_url = navigation.params.start_url as string;
            sessionManager.captureFromToolResult({ session_id: startResult.session_id });
          }
          return { success: startResult.success };

        case 'navigate':
          if (!this.state.session_id) {
            return { success: false, error: 'No session for navigation' };
          }
          return await toolServerClient.browserNavigate(
            this.state.session_id,
            navigation.params.url as string
          );

        default:
          return { success: false, error: `Unknown navigation action: ${navigation.action}` };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown' 
      };
    }
  }

  // ============================================================
  // PHASE 1: BROWSER INITIALIZATION
  // ============================================================

  private async initializeBrowser(startUrl?: string): Promise<void> {
    this.checkAbort();
    this.updateStatus('initializing');
    this.log('info', 'Inizializzazione browser...');

    const url = startUrl || 'about:blank';
    
    try {
      const result = await toolServerClient.browserStart(url);
      
      if (!result.success || !result.session_id) {
        throw new Error('Failed to start browser session');
      }

      this.state.session_id = result.session_id;
      this.state.current_url = url;
      sessionManager.captureFromToolResult({ session_id: result.session_id });
      
      this.log('success', `Browser avviato, session: ${result.session_id.slice(0, 8)}...`);
    } catch (error) {
      throw new Error(`Browser init failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // ============================================================
  // PHASE 2: PLANNING (ONLY LLM CALL)
  // ============================================================

  private async createPlan(): Promise<void> {
    this.checkAbort();
    this.updateStatus('planning');
    this.log('info', 'Ottenendo DOM Tree...');

    // Get DOM Tree
    const domResult = await toolServerClient.getDomTree(this.state.session_id!);
    if (!domResult.success) {
      throw new Error('Failed to get DOM tree');
    }

    this.log('info', 'Chiamata al Planner Agent...');

    // Call Planner Agent (THE ONLY LLM CALL)
    const plan = await this.callPlannerAgent(
      this.state.task,
      domResult.tree,
      this.state.current_url || ''
    );

    this.state.plan = plan;
    this.callbacks.onPlanCreated?.(plan);
    
    this.log('success', `Piano creato: ${plan.steps.length} step`);
    this.log('info', `Obiettivo: ${plan.goal}`);
  }

  private async callPlannerAgent(task: string, domTree: string, url: string): Promise<Plan> {
    const userMessage = `Task: ${task}

URL: ${url}

DOM Tree:
${domTree.slice(0, 15000)}${domTree.length > 15000 ? '\n[...truncated...]' : ''}`;

    try {
      const { data, error } = await supabase.functions.invoke('tool-server-llm', {
        body: {
          messages: [{ role: 'user', content: userMessage }],
          system_prompt: PLANNER_AGENT_SYSTEM_PROMPT,
          model: PLANNER_AGENT_CONFIG.model,
          temperature: PLANNER_AGENT_CONFIG.temperature,
          max_tokens: PLANNER_AGENT_CONFIG.max_tokens,
        },
      });

      if (error) throw error;

      // Parse JSON response
      const responseText = data.response || data.content || '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in Planner response');
      }

      const plan = JSON.parse(jsonMatch[0]) as Plan;
      
      // Validate plan structure
      if (!plan.steps || !Array.isArray(plan.steps)) {
        throw new Error('Invalid plan structure: missing steps array');
      }

      return plan;

    } catch (error) {
      this.log('error', `Planner Agent error: ${error instanceof Error ? error.message : 'Unknown'}`);
      throw new Error(`Planner failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // ============================================================
  // PHASE 3: PLAN EXECUTION
  // ============================================================

  private async executePlan(): Promise<void> {
    await this.executePlanSteps();
  }

  /**
   * Internal method to execute plan steps.
   * Used by both executeTask() and executePlanFromCloud().
   */
  private async executePlanSteps(): Promise<void> {
    if (!this.state.plan || this.state.plan.steps.length === 0) {
      this.log('info', 'Nessuno step da eseguire - obiettivo già raggiunto');
      return;
    }

    this.updateStatus('executing');

    for (let i = 0; i < this.state.plan.steps.length; i++) {
      this.checkAbort();
      
      // Check max steps
      if (i >= this.config.maxSteps) {
        throw new Error(`Max steps limit reached (${this.config.maxSteps})`);
      }

      // Check for loops
      const loopResult = this.loopDetector.detectLoop();
      if (loopResult.isLoop) {
        this.state.status = 'loop_detected';
        this.log('warn', `Loop rilevato: ${loopResult.suggestion}`);
        throw new Error(`Loop detected: ${loopResult.suggestion}`);
      }

      const step = this.state.plan.steps[i];
      this.state.current_step_index = i;
      this.callbacks.onStepStart?.(step, i);
      this.log('info', `Step ${i + 1}/${this.state.plan.steps.length}: ${step.action_type} - ${step.target_description}`);

      const execution = await this.executeStep(step);
      this.state.executed_steps.push(execution);
      this.callbacks.onStepComplete?.(execution, i);

      if (!execution.success) {
        throw new Error(`Step ${i + 1} failed: ${execution.action_result?.error || 'Unknown'}`);
      }

      this.notifyStateChange();
    }
  }

  private async executeStep(step: PlanStep): Promise<StepExecution> {
    const startTime = Date.now();
    let execution: StepExecution = {
      step,
      vision_result: null,
      action_result: null,
      success: false,
      retries: 0,
      used_fallback: false,
      duration_ms: 0,
    };

    try {
      // Handle special action types that don't need vision
      if (step.action_type === 'navigate') {
        const result = await toolServerClient.browserNavigate(this.state.session_id!, step.input_value!);
        execution.action_result = { success: result.success, error: result.error };
        execution.success = result.success;
        return this.finalizeExecution(execution, startTime);
      }

      if (step.action_type === 'wait') {
        await this.sleep(parseInt(step.input_value || '1000'));
        execution.action_result = { success: true };
        execution.success = true;
        return this.finalizeExecution(execution, startTime);
      }

      // For actions that need coordinates, try vision
      for (let retry = 0; retry <= this.config.maxRetries; retry++) {
        execution.retries = retry;
        
        const targetDesc = retry > 0 && step.fallback_description 
          ? step.fallback_description 
          : step.target_description;
        
        if (retry > 0) {
          execution.used_fallback = true;
          this.log('warn', `Retry ${retry} con fallback: ${targetDesc}`);
        }

        // Take screenshot
        const screenshot = await this.takeScreenshot();
        if (!screenshot) {
          this.log('error', 'Screenshot fallito');
          continue;
        }

        // Try to get coordinates from cache first
        const cached = this.actionCache.get(this.state.current_url || '', targetDesc);
        let visionResult: VisionResult;

        if (cached && cached.success_count >= 2) {
          this.log('debug', 'Usando coordinate dalla cache');
          visionResult = {
            found: true,
            x: cached.x,
            y: cached.y,
            confidence: 1,
            coordinate_system: cached.coordinate_system,
            reasoning: 'From cache',
          };
        } else {
          // Vision: Try Lux first, then Gemini as fallback
          visionResult = await this.callLuxVision(screenshot, targetDesc);
          
          if (!visionResult.found || visionResult.confidence < this.config.confidenceThreshold) {
            this.log('warn', 'Lux Vision non ha trovato target, provo Gemini...');
            visionResult = await this.callGeminiVision(screenshot, targetDesc, step.expected_outcome);
          }
        }

        execution.vision_result = visionResult;

        if (!visionResult.found || visionResult.x === null || visionResult.y === null) {
          this.log('warn', `Elemento non trovato: ${targetDesc}`);
          continue;
        }

        // Execute the action
        const actionResult = await this.executeAction(step, visionResult);
        execution.action_result = actionResult;
        execution.success = actionResult.success;

        // Record action for loop detection
        this.recordAction(step, visionResult, actionResult.success);

        // Update cache
        if (actionResult.success) {
          this.actionCache.recordSuccess(
            this.state.current_url || '',
            targetDesc,
            visionResult.x,
            visionResult.y,
            visionResult.coordinate_system
          );
          this.log('success', `Azione completata: ${step.action_type}`);
          break;
        } else {
          this.actionCache.recordFailure(this.state.current_url || '', targetDesc);
        }
      }

    } catch (error) {
      execution.action_result = { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown' 
      };
    }

    return this.finalizeExecution(execution, startTime);
  }

  // ============================================================
  // VISION FUNCTIONS (NO LLM - Direct API calls)
  // ============================================================

  private async callLuxVision(screenshot: string, target: string): Promise<VisionResult> {
    try {
      const { data, error } = await supabase.functions.invoke('tool-server-vision', {
        body: {
          provider: 'lux',
          image: screenshot,
          task: `Find and locate: ${target}`,
        },
      });

      if (error) throw error;

      return {
        found: data.success && data.x !== undefined,
        x: data.x ?? null,
        y: data.y ?? null,
        confidence: data.confidence ?? 0,
        coordinate_system: 'lux_sdk',
        reasoning: data.action || null,
      };

    } catch (err) {
      this.log('warn', `Lux Vision error: ${err instanceof Error ? err.message : 'Unknown'}`);
      return {
        found: false,
        x: null,
        y: null,
        confidence: 0,
        coordinate_system: 'lux_sdk',
        reasoning: `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
      };
    }
  }

  private async callGeminiVision(screenshot: string, target: string, context?: string): Promise<VisionResult> {
    const prompt = `Trova l'elemento "${target}" nello screenshot.
${context ? `Contesto: ${context}` : ''}
Rispondi SOLO con JSON: {"x": numero, "y": numero, "confidence": 0.0-1.0, "reasoning": "..."}`;

    try {
      const { data, error } = await supabase.functions.invoke('tool-server-vision', {
        body: {
          provider: 'gemini',
          image: screenshot,
          prompt,
        },
      });

      if (error) throw error;

      return {
        found: data.success && data.x !== undefined,
        x: data.x ?? null,
        y: data.y ?? null,
        confidence: data.confidence ?? 0,
        coordinate_system: 'viewport',
        reasoning: data.reasoning || null,
      };

    } catch (err) {
      this.log('warn', `Gemini Vision error: ${err instanceof Error ? err.message : 'Unknown'}`);
      return {
        found: false,
        x: null,
        y: null,
        confidence: 0,
        coordinate_system: 'viewport',
        reasoning: `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
      };
    }
  }

  // ============================================================
  // ACTION EXECUTION
  // ============================================================

  private async executeAction(
    step: PlanStep, 
    vision: VisionResult
  ): Promise<{ success: boolean; error?: string }> {
    const sessionId = this.state.session_id!;

    try {
      switch (step.action_type) {
        case 'click':
          return await toolServerClient.click({
            scope: 'browser',
            session_id: sessionId,
            x: vision.x!,
            y: vision.y!,
            coordinate_origin: vision.coordinate_system,
          });

        case 'type':
          // First click to focus
          await toolServerClient.click({
            scope: 'browser',
            session_id: sessionId,
            x: vision.x!,
            y: vision.y!,
            coordinate_origin: vision.coordinate_system,
          });
          await this.sleep(200);
          
          return await toolServerClient.type({
            scope: 'browser',
            session_id: sessionId,
            text: step.input_value || '',
          });

        case 'scroll':
          const direction = step.target_description.toLowerCase().includes('up') ? 'up' : 'down';
          return await toolServerClient.scroll({
            scope: 'browser',
            session_id: sessionId,
            direction,
            amount: 300,
          });

        case 'keypress':
          return await toolServerClient.keypress({
            scope: 'browser',
            session_id: sessionId,
            keys: step.input_value || 'Enter',
          });

        default:
          return { success: false, error: `Unknown action type: ${step.action_type}` };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown' 
      };
    }
  }

  // ============================================================
  // HELPER METHODS
  // ============================================================

  private async takeScreenshot(): Promise<string | null> {
    try {
      const result = await toolServerClient.screenshot({
        session_id: this.state.session_id!,
        scope: 'browser',
      });
      return result.success ? result.original.image_base64 : null;
    } catch {
      return null;
    }
  }

  private recordAction(step: PlanStep, vision: VisionResult, success: boolean): void {
    const record: ActionRecord = {
      timestamp: Date.now(),
      action_type: step.action_type,
      target_description: step.target_description,
      x: vision.x,
      y: vision.y,
      url: this.state.current_url || '',
      success,
    };
    this.loopDetector.addAction(record);
  }

  private finalizeExecution(execution: StepExecution, startTime: number): StepExecution {
    execution.duration_ms = Date.now() - startTime;
    return execution;
  }

  private updateStatus(status: OrchestratorStatus): void {
    this.state.status = status;
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    this.callbacks.onStateChange?.({ ...this.state });
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      data,
    };
    this.logs.push(entry);
    this.callbacks.onLog?.(entry);
  }

  private checkAbort(): void {
    if (this.abortController?.signal.aborted || this.state.status === 'aborted') {
      throw new Error('Aborted');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Factory function
export function createOrchestrator(
  config?: Partial<OrchestratorConfig>,
  callbacks?: OrchestratorCallbacks
): Orchestrator {
  return new Orchestrator(config, callbacks);
}
