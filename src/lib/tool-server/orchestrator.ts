// ============================================================
// ORCHESTRATOR - Multi-Agent Orchestrator with Deterministic Logic
// ============================================================

import { supabase } from '@/integrations/supabase/client';
import { toolServerClient } from './client';
import { sessionManager } from './session-manager';
import { LoopDetector } from './loop-detector';
import { ActionCache } from './action-cache';
import { BROWSER_ORCHESTRATOR_CONFIG } from './agent-prompts';
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
  DomForPlanningResult,
  DomElementRect,
  TripleVerificationResult,
  TripleVerificationPattern,
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

  /**
   * @deprecated Use executePlanFromCloud() instead.
   * This method previously called a Planner LLM, but now plans should be
   * created by the Agent (with KB) and passed to executePlanFromCloud().
   * 
   * This method is kept for backwards compatibility but will throw an error
   * guiding users to use the new API.
   */
  async executeTask(_task: string, _startUrl?: string): Promise<OrchestratorState> {
    throw new Error(
      'executeTask() is deprecated. ' +
      'Plans should now be created by the Agent (with KB) and passed to executePlanFromCloud(). ' +
      'Use: orchestrator.executePlanFromCloud(plan, { startUrl })'
    );
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

  // ============================================================
  // DOM ANALYSIS FOR PLANNING (Step 1: Agente chiama questo)
  // ============================================================

  /**
   * Step 1 del flusso: L'Agente chiama questo per ottenere la struttura del sito
   * PRIMA di creare il piano. L'Agente studia il DOM + KB e poi crea il piano.
   */
  async getDomForPlanning(startUrl: string): Promise<DomForPlanningResult & { element_count: number }> {
    this.log('info', `Getting DOM for planning: ${startUrl}`);
    
    // 1. Inizializza browser se necessario
    if (!this.state.session_id) {
      await this.initializeBrowser(startUrl);
    } else if (startUrl && this.state.current_url !== startUrl) {
      // Navigate to new URL if different
      await toolServerClient.browserNavigate(this.state.session_id, startUrl);
      this.state.current_url = startUrl;
    }
    
    // Wait for page load
    await this.sleep(2000);
    
    // 2. Ottieni DOM tree
    const { tree, success } = await toolServerClient.getDomTree(this.state.session_id!);
    
    if (!success || !tree) {
      throw new Error('Failed to retrieve DOM tree for planning');
    }
    
    // 3. Filtra elementi interattivi
    const filteredDom = this.filterDomForPlanning(tree);
    
    // 4. Comprimi a max 8000 caratteri
    const maxChars = 8000;
    let compressedDom = filteredDom;
    
    if (compressedDom.length > maxChars) {
      const lines = compressedDom.split('\n');
      let result = '';
      let charCount = 0;
      
      for (const line of lines) {
        if (charCount + line.length + 1 > maxChars - 100) {
          result += '\n... [TRUNCATED - too many elements]';
          break;
        }
        result += line + '\n';
        charCount += line.length + 1;
      }
      compressedDom = result;
    }
    
    const elementCount = (compressedDom.match(/\[.*?\]|<.*?>/g) || []).length;
    
    this.log('success', `DOM retrieved: ${tree.length} chars raw → ${compressedDom.length} chars filtered (${elementCount} elements)`);
    
    return {
      dom_tree: compressedDom,
      session_id: this.state.session_id!,
      current_url: this.state.current_url!,
      element_count: elementCount,
    };
  }

  /**
   * Filtra DOM per mantenere solo elementi interattivi e rilevanti.
   */
  private filterDomForPlanning(rawDom: string): string {
    const lines = rawDom.split('\n');
    const filteredLines: string[] = [];
    
    // Pattern per elementi interattivi
    const interactivePatterns = [
      /\[button\]/i,
      /\[link\]/i,
      /\[textbox\]/i,
      /\[combobox\]/i,
      /\[checkbox\]/i,
      /\[radio\]/i,
      /\[menuitem\]/i,
      /\[tab\]/i,
      /\[searchbox\]/i,
      /<button/i,
      /<a /i,
      /<input/i,
      /<textarea/i,
      /<select/i,
      /<form/i,
      /type=["']?submit/i,
      /type=["']?button/i,
      /role=/i,
      /aria-label=/i,
      /data-action=/i,
      /data-testid=/i,
      /onclick/i,
    ];
    
    // Pattern per elementi da escludere
    const excludePatterns = [
      /<style/i,
      /<script/i,
      /display:\s*none/i,
      /visibility:\s*hidden/i,
      /opacity:\s*0[^.]/i,
    ];
    
    for (const line of lines) {
      // Salta linee vuote
      if (!line.trim()) continue;
      
      // Salta elementi nascosti
      if (excludePatterns.some(p => p.test(line))) continue;
      
      // Mantieni elementi interattivi
      if (interactivePatterns.some(p => p.test(line))) {
        // Pulisci la linea (rimuovi spazi extra)
        const cleanLine = line.replace(/\s+/g, ' ').trim();
        if (cleanLine.length > 10) { // Ignora linee troppo corte
          filteredLines.push(cleanLine);
        }
      }
      
      // Mantieni anche container con aria-label (spesso sono cliccabili)
      if (/aria-label=/.test(line) && line.includes('"')) {
        const cleanLine = line.replace(/\s+/g, ' ').trim();
        if (!filteredLines.includes(cleanLine)) {
          filteredLines.push(cleanLine);
        }
      }
    }
    
    // Rimuovi duplicati
    const uniqueLines = [...new Set(filteredLines)];
    
    return uniqueLines.join('\n');
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
  // PHASE 2: PLANNING - REMOVED
  // ============================================================
  // NOTE: The Planner LLM has been removed from the orchestrator.
  // Plans are now created by the Agent (with KB) and passed to 
  // executePlanFromCloud(). This reduces LLM calls and improves accuracy.
  // ============================================================

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

      // For actions that need coordinates, use TRIPLE VERIFICATION
      for (let retry = 0; retry <= this.config.maxRetries; retry++) {
        execution.retries = retry;
        
        const targetDesc = retry > 0 && step.fallback_description 
          ? step.fallback_description 
          : step.target_description;
        
        if (retry > 0) {
          execution.used_fallback = true;
          this.log('warn', `Retry ${retry} con fallback: ${targetDesc}`);
          await this.sleep(500); // Brief pause before retry
        }

        // Take screenshot
        const screenshot = await this.takeScreenshot();
        if (!screenshot) {
          this.log('error', 'Screenshot fallito');
          continue;
        }

        // ============================================================
        // TRIPLE VERIFICATION: DOM + Lux + Gemini in PARALLEL
        // ============================================================
        const tripleResult = await this.verifyCoordinatesTriple(
          screenshot,
          targetDesc,
          step.dom_selector,
          step.expected_outcome
        );
        
        // Log verification result
        this.log('info', `Triple Verify: pattern=${tripleResult.verification.pattern}, ` +
          `proceed=${tripleResult.verification.proceed}, conf=${tripleResult.verification.confidence.toFixed(2)}`);
        
        if (tripleResult.verification.warning) {
          this.log('warn', `⚠️ ${tripleResult.verification.warning}`);
        }
        
        // If verification says don't proceed → retry
        if (!tripleResult.verification.proceed) {
          this.log('warn', `Verifica fallita: ${tripleResult.verification.pattern}. Retry...`);
          continue;
        }
        
        // We have verified coordinates
        const coords = tripleResult.final_coordinates!;
        this.log('debug', `Using coordinates: (${coords.x}, ${coords.y}) from ${coords.source}`);
        
        // Create VisionResult for compatibility
        const visionResult: VisionResult = {
          found: true,
          x: coords.x,
          y: coords.y,
          confidence: tripleResult.verification.confidence,
          coordinate_system: 'viewport', // Always viewport after triple verification
          reasoning: `Triple verified: ${tripleResult.verification.pattern}`,
        };
        execution.vision_result = visionResult;

        // Execute the action via toolServerClient
        const actionResult = await this.executeActionWithCoords(step, coords.x, coords.y);
        execution.action_result = actionResult;
        execution.success = actionResult.success;

        // Record action for loop detection
        this.recordAction(step, visionResult, actionResult.success);

        if (actionResult.success) {
          this.log('success', `Azione completata: ${step.action_type}`);
          break;
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
  // TRIPLE VERIFICATION: DOM + Lux + Gemini
  // ============================================================

  private async verifyCoordinatesTriple(
    screenshot: string,
    target: string,
    selector?: string,
    context?: string
  ): Promise<TripleVerificationResult> {
    // Call all 3 sources IN PARALLEL
    const [domResult, luxResult, geminiResult] = await Promise.all([
      this.getDomElementRect(selector, target),
      this.callLuxVision(screenshot, target),
      this.callGeminiVision(screenshot, target, context),
    ]);

    // Log individual results
    this.log('debug', `DOM: found=${domResult?.found ?? false}, visible=${domResult?.visible ?? false}, ` +
      `pos=(${domResult?.x ?? 'N/A'}, ${domResult?.y ?? 'N/A'})`);
    this.log('debug', `Lux: found=${luxResult.found} (${luxResult.x}, ${luxResult.y}) conf=${luxResult.confidence}`);
    this.log('debug', `Gemini: found=${geminiResult.found} (${geminiResult.x}, ${geminiResult.y}) conf=${geminiResult.confidence}`);

    // Analyze the pattern
    const analysis = this.analyzeTriplePattern(domResult, luxResult, geminiResult);
    
    // Make decision based on pattern
    const decision = this.makeTripleDecision(analysis, domResult, luxResult, geminiResult);
    
    return {
      dom: domResult,
      lux: luxResult,
      gemini: geminiResult,
      verification: {
        pattern: analysis.type,
        proceed: decision.proceed,
        confidence: decision.confidence,
        warning: decision.warning,
      },
      final_coordinates: decision.coordinates,
      distances: analysis.distances,
    };
  }

  private async getDomElementRect(
    selector?: string,
    textContent?: string
  ): Promise<DomElementRect | null> {
    if (!this.state.session_id) return null;
    
    try {
      const result = await toolServerClient.getElementRect({
        session_id: this.state.session_id,
        selector,
        text: textContent,
      });
      
      if (!result.success || !result.found) {
        return null;
      }
      
      // ToolServer already returns x,y as center coordinates
      return {
        found: result.found,
        visible: result.visible,
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
      };
    } catch {
      return null;
    }
  }

  private analyzeTriplePattern(
    dom: DomElementRect | null,
    lux: VisionResult,
    gemini: VisionResult
  ): { type: TripleVerificationPattern; distances: { lux_gemini: number; dom_lux: number; dom_gemini: number } } {
    
    const THRESHOLD_AGREE = 50;      // Considered "same"
    const THRESHOLD_WARNING = 150;   // Threshold for overlay warning
    
    const luxFound = lux.found && lux.x !== null && lux.y !== null;
    const geminiFound = gemini.found && gemini.x !== null && gemini.y !== null;
    const domFound = dom !== null && dom.visible;
    
    // Calculate distances
    const dist = {
      lux_gemini: -1,
      dom_lux: -1,
      dom_gemini: -1,
    };
    
    if (luxFound && geminiFound) {
      dist.lux_gemini = Math.sqrt(
        Math.pow((lux.x ?? 0) - (gemini.x ?? 0), 2) +
        Math.pow((lux.y ?? 0) - (gemini.y ?? 0), 2)
      );
    }
    
    if (domFound && luxFound) {
      dist.dom_lux = Math.sqrt(
        Math.pow(dom.x - (lux.x ?? 0), 2) +
        Math.pow(dom.y - (lux.y ?? 0), 2)
      );
    }
    
    if (domFound && geminiFound) {
      dist.dom_gemini = Math.sqrt(
        Math.pow(dom.x - (gemini.x ?? 0), 2) +
        Math.pow(dom.y - (gemini.y ?? 0), 2)
      );
    }
    
    // Determine pattern
    let type: TripleVerificationPattern;
    
    if (!domFound && !luxFound && !geminiFound) {
      type = 'none_found';
    } else if (domFound && !luxFound && !geminiFound) {
      type = 'dom_only';
    } else if (!domFound && (luxFound || geminiFound)) {
      // Vision finds but DOM doesn't
      if (luxFound && geminiFound && dist.lux_gemini < THRESHOLD_AGREE) {
        type = 'vision_only';
      } else if (luxFound && geminiFound) {
        type = 'vision_disagree';
      } else {
        type = 'vision_only';
      }
    } else if (luxFound && geminiFound) {
      const visionAgree = dist.lux_gemini < THRESHOLD_AGREE;
      
      if (visionAgree && domFound) {
        const avgDomDist = (dist.dom_lux + dist.dom_gemini) / 2;
        if (avgDomDist < THRESHOLD_AGREE) {
          type = 'all_agree';
        } else if (avgDomDist < THRESHOLD_WARNING) {
          type = 'vision_agree_dom_far';
        } else {
          type = 'vision_agree_dom_very_far';
        }
      } else if (visionAgree && !domFound) {
        type = 'vision_only';
      } else {
        type = 'vision_disagree';
      }
    } else if (domFound && (luxFound || geminiFound)) {
      type = 'dom_one_vision';
    } else {
      type = 'vision_only';
    }
    
    return { type, distances: dist };
  }

  private makeTripleDecision(
    analysis: { type: TripleVerificationPattern; distances: { lux_gemini: number; dom_lux: number; dom_gemini: number } },
    dom: DomElementRect | null,
    lux: VisionResult,
    gemini: VisionResult
  ): {
    proceed: boolean;
    coordinates: { x: number; y: number; source: 'all_avg' | 'vision_avg' | 'dom' | 'lux' | 'gemini' } | null;
    confidence: number;
    warning?: string;
  } {
    switch (analysis.type) {
      case 'all_agree': {
        // All 3 agree → average of all 3 coordinates
        const x = Math.round((dom!.x + (lux.x ?? 0) + (gemini.x ?? 0)) / 3);
        const y = Math.round((dom!.y + (lux.y ?? 0) + (gemini.y ?? 0)) / 3);
        return {
          proceed: true,
          coordinates: { x, y, source: 'all_avg' },
          confidence: 1.0,
        };
      }
      
      case 'vision_agree_dom_far': {
        // Vision agree, DOM far → warning overlay, use vision avg
        const x = Math.round(((lux.x ?? 0) + (gemini.x ?? 0)) / 2);
        const y = Math.round(((lux.y ?? 0) + (gemini.y ?? 0)) / 2);
        return {
          proceed: true,
          coordinates: { x, y, source: 'vision_avg' },
          confidence: 0.8,
          warning: `Possible overlay: DOM at (${dom?.x},${dom?.y}), Vision at (${x},${y}). ` +
                   `Avg distance: ${Math.round((analysis.distances.dom_lux + analysis.distances.dom_gemini) / 2)}px`,
        };
      }
      
      case 'vision_agree_dom_very_far': {
        // Vision agree, DOM very far → DON'T proceed, retry
        return {
          proceed: false,
          coordinates: null,
          confidence: 0.3,
          warning: `DOM molto distante dalla vision (>150px). Possibile elemento nascosto o scroll necessario.`,
        };
      }
      
      case 'vision_disagree': {
        // Vision disagree → DON'T proceed, retry
        return {
          proceed: false,
          coordinates: null,
          confidence: 0.2,
          warning: `Lux e Gemini discordano: Lux(${lux.x},${lux.y}) vs Gemini(${gemini.x},${gemini.y}). ` +
                   `Distanza: ${Math.round(analysis.distances.lux_gemini)}px`,
        };
      }
      
      case 'dom_one_vision': {
        // DOM + 1 vision → use average of those 2 (2/3 agreement)
        const luxDist = analysis.distances.dom_lux;
        const geminiDist = analysis.distances.dom_gemini;
        
        // Choose the vision closer to DOM
        if (luxDist >= 0 && (geminiDist < 0 || luxDist < geminiDist)) {
          const x = Math.round((dom!.x + (lux.x ?? 0)) / 2);
          const y = Math.round((dom!.y + (lux.y ?? 0)) / 2);
          return {
            proceed: true,
            coordinates: { x, y, source: 'vision_avg' },
            confidence: 0.75,
            warning: 'Only DOM + Lux found element',
          };
        } else if (geminiDist >= 0) {
          const x = Math.round((dom!.x + (gemini.x ?? 0)) / 2);
          const y = Math.round((dom!.y + (gemini.y ?? 0)) / 2);
          return {
            proceed: true,
            coordinates: { x, y, source: 'vision_avg' },
            confidence: 0.75,
            warning: 'Only DOM + Gemini found element',
          };
        }
        return { proceed: false, coordinates: null, confidence: 0 };
      }
      
      case 'dom_only': {
        // Only DOM finds → element probably hidden, DON'T click
        return {
          proceed: false,
          coordinates: null,
          confidence: 0,
          warning: 'Element exists in DOM but not visible to vision. Likely hidden or covered.',
        };
      }
      
      case 'vision_only': {
        // Only vision finds → proceed with caution
        const luxFound = lux.found && lux.x !== null;
        const geminiFound = gemini.found && gemini.x !== null;
        
        if (luxFound && geminiFound && analysis.distances.lux_gemini < 50) {
          const x = Math.round(((lux.x ?? 0) + (gemini.x ?? 0)) / 2);
          const y = Math.round(((lux.y ?? 0) + (gemini.y ?? 0)) / 2);
          return {
            proceed: true,
            coordinates: { x, y, source: 'vision_avg' },
            confidence: 0.7,
            warning: 'Element not in DOM but both vision models agree. Proceeding with caution.',
          };
        } else if (luxFound) {
          return {
            proceed: true,
            coordinates: { x: lux.x!, y: lux.y!, source: 'lux' },
            confidence: lux.confidence * 0.6,
            warning: 'Only Lux found element, DOM not available',
          };
        } else if (geminiFound) {
          return {
            proceed: true,
            coordinates: { x: gemini.x!, y: gemini.y!, source: 'gemini' },
            confidence: gemini.confidence * 0.6,
            warning: 'Only Gemini found element, DOM not available',
          };
        }
        return { proceed: false, coordinates: null, confidence: 0 };
      }
      
      case 'none_found':
      default:
        return {
          proceed: false,
          coordinates: null,
          confidence: 0,
          warning: 'No source found the element',
        };
    }
  }

  // ============================================================
  // ACTION EXECUTION WITH COORDS
  // ============================================================

  private async executeActionWithCoords(
    step: PlanStep,
    x: number,
    y: number
  ): Promise<{ success: boolean; error?: string }> {
    const sessionId = this.state.session_id!;

    try {
      switch (step.action_type) {
        case 'click':
          return await toolServerClient.click({
            scope: 'browser',
            session_id: sessionId,
            x,
            y,
            coordinate_origin: 'viewport',
          });

        case 'type':
          // First click to focus
          await toolServerClient.click({
            scope: 'browser',
            session_id: sessionId,
            x,
            y,
            coordinate_origin: 'viewport',
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
  // VISION FUNCTIONS (NO LLM - Direct API calls)
  // ============================================================

  // ============================================================
  // COORDINATE CONVERSION CONSTANTS
  // Lux API returns coordinates in 1260x700 space (lux_sdk)
  // Browser viewport is typically 1280x720 (viewport)
  // ============================================================
  private static readonly LUX_SDK_WIDTH = 1260;
  private static readonly LUX_SDK_HEIGHT = 700;
  private static readonly VIEWPORT_WIDTH = 1280;
  private static readonly VIEWPORT_HEIGHT = 720;

  /**
   * Convert Lux SDK coordinates (1260x700) to viewport coordinates (1280x720).
   * Used for browser automation where we need viewport-relative clicks.
   */
  private luxToViewport(x: number, y: number): { x: number; y: number } {
    return {
      x: Math.round(x * Orchestrator.VIEWPORT_WIDTH / Orchestrator.LUX_SDK_WIDTH),
      y: Math.round(y * Orchestrator.VIEWPORT_HEIGHT / Orchestrator.LUX_SDK_HEIGHT),
    };
  }

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

      // Convert Lux coordinates to viewport coordinates for browser use
      let finalX = data.x ?? null;
      let finalY = data.y ?? null;

      if (finalX !== null && finalY !== null) {
        const converted = this.luxToViewport(finalX, finalY);
        this.log('info', `🔄 Lux coords (${finalX}, ${finalY}) → viewport (${converted.x}, ${converted.y})`);
        finalX = converted.x;
        finalY = converted.y;
      }

      return {
        found: data.success && finalX !== undefined,
        x: finalX,
        y: finalY,
        confidence: data.confidence ?? 0,
        coordinate_system: 'viewport',  // Now returns viewport coordinates
        reasoning: data.action || null,
      };

    } catch (err) {
      this.log('warn', `Lux Vision error: ${err instanceof Error ? err.message : 'Unknown'}`);
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
