// ============================================================
// ORCHESTRATOR LOGGING - Structured Logging for Procedure-Based Automation
// ============================================================
// Tracks Triple Verification results, step executions, and discrepancies
// for learning and procedure optimization.
// ============================================================

import type {
  PlanStep,
  TripleVerificationPattern,
  VisionResult,
  DomElementRect
} from './orchestrator-types';

// ============================================================
// VERIFICATION LOG - Detailed Triple Verification Result
// ============================================================

export interface SourceResult {
  found: boolean;
  x: number | null;
  y: number | null;
  confidence: number;
  latency_ms: number;
}

export interface DomSourceResult extends SourceResult {
  selector_used?: string;
  element_visible: boolean;
}

export interface VisionSourceResult extends SourceResult {
  model: string;
  normalized_coords?: { x: number; y: number }; // Original coords before conversion
}

export interface VerificationLog {
  timestamp: string;
  target_description: string;

  // Results from each source
  sources: {
    dom: DomSourceResult | null;
    lux: VisionSourceResult;
    gemini: VisionSourceResult;
  };

  // Computed distances
  distances: {
    dom_lux: number;
    dom_gemini: number;
    lux_gemini: number;
  };

  // Analysis result
  pattern: TripleVerificationPattern;
  decision: 'proceed' | 'retry' | 'fail';
  final_coordinates: { x: number; y: number; source: string } | null;

  // Optional screenshots for debugging
  screenshot_before_b64?: string;
  screenshot_after_b64?: string;
}

// ============================================================
// STEP LOG - Single Step Execution Record
// ============================================================

export interface StepLog {
  step_number: number;
  action_type: string;
  target_description: string;

  // Triple verification result
  verification: VerificationLog;

  // Execution result
  execution: {
    success: boolean;
    error?: string;
    retries: number;
    used_fallback: boolean;
    duration_ms: number;
  };

  // For procedure learning
  learned_data?: {
    dom_selector?: string;
    ref?: string;
    verified_by: ('dom' | 'lux' | 'gemini')[];
    confidence: number;
  };
}

// ============================================================
// EXECUTION LOG - Full Task Execution Record
// ============================================================

export interface ExecutionStats {
  total_steps: number;
  successful_steps: number;
  failed_steps: number;

  // Pattern distribution
  patterns: Record<TripleVerificationPattern, number>;

  // Discrepancy tracking
  dom_vision_discrepancies: number;
  vision_vision_discrepancies: number;

  // Performance
  total_duration_ms: number;
  avg_step_duration_ms: number;

  // API usage
  lux_calls: number;
  gemini_calls: number;
  dom_calls: number;
}

export interface ExecutionLog {
  execution_id: string;
  task_description: string;
  procedure_id?: string; // Link to saved procedure if using one

  // Execution context
  mode: 'learning' | 'execution';
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed' | 'partial';

  // Step-by-step log
  steps: StepLog[];

  // Aggregated stats
  stats: ExecutionStats;

  // Environment info
  environment: {
    url: string;
    viewport: { width: number; height: number };
    session_id: string;
  };
}

// ============================================================
// EXECUTION LOG MANAGER
// ============================================================

export class ExecutionLogManager {
  private currentLog: ExecutionLog | null = null;
  private stepLogs: StepLog[] = [];
  private patternCounts: Record<TripleVerificationPattern, number>;

  constructor() {
    this.patternCounts = {
      all_agree: 0,
      vision_agree_dom_far: 0,
      vision_agree_dom_very_far: 0,
      vision_disagree: 0,
      dom_one_vision: 0,
      dom_only: 0,
      vision_only: 0,
      none_found: 0,
    };
  }

  /**
   * Start a new execution log
   */
  startExecution(params: {
    task_description: string;
    mode: 'learning' | 'execution';
    procedure_id?: string;
    url: string;
    session_id: string;
  }): string {
    const execution_id = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.currentLog = {
      execution_id,
      task_description: params.task_description,
      procedure_id: params.procedure_id,
      mode: params.mode,
      started_at: new Date().toISOString(),
      status: 'running',
      steps: [],
      stats: {
        total_steps: 0,
        successful_steps: 0,
        failed_steps: 0,
        patterns: { ...this.patternCounts },
        dom_vision_discrepancies: 0,
        vision_vision_discrepancies: 0,
        total_duration_ms: 0,
        avg_step_duration_ms: 0,
        lux_calls: 0,
        gemini_calls: 0,
        dom_calls: 0,
      },
      environment: {
        url: params.url,
        viewport: { width: 1260, height: 700 },
        session_id: params.session_id,
      },
    };

    this.stepLogs = [];
    this.patternCounts = {
      all_agree: 0,
      vision_agree_dom_far: 0,
      vision_agree_dom_very_far: 0,
      vision_disagree: 0,
      dom_one_vision: 0,
      dom_only: 0,
      vision_only: 0,
      none_found: 0,
    };

    console.log(`[LOG] Started execution: ${execution_id}`);
    return execution_id;
  }

  /**
   * Log a verification result (called during verifyCoordinatesTriple)
   */
  logVerification(params: {
    target_description: string;
    dom: DomElementRect | null;
    dom_latency_ms: number;
    dom_selector?: string;
    lux: VisionResult;
    lux_latency_ms: number;
    gemini: VisionResult;
    gemini_latency_ms: number;
    distances: { dom_lux: number; dom_gemini: number; lux_gemini: number };
    pattern: TripleVerificationPattern;
    proceed: boolean;
    final_coordinates: { x: number; y: number; source: string } | null;
    screenshot_b64?: string;
  }): VerificationLog {
    const verification: VerificationLog = {
      timestamp: new Date().toISOString(),
      target_description: params.target_description,
      sources: {
        dom: params.dom ? {
          found: params.dom.found,
          x: params.dom.x,
          y: params.dom.y,
          confidence: 1.0, // DOM is deterministic
          latency_ms: params.dom_latency_ms,
          selector_used: params.dom_selector,
          element_visible: params.dom.visible,
        } : null,
        lux: {
          found: params.lux.found,
          x: params.lux.x,
          y: params.lux.y,
          confidence: params.lux.confidence,
          latency_ms: params.lux_latency_ms,
          model: 'lux-actor-1',
        },
        gemini: {
          found: params.gemini.found,
          x: params.gemini.x,
          y: params.gemini.y,
          confidence: params.gemini.confidence,
          latency_ms: params.gemini_latency_ms,
          model: 'gemini-2.0-flash',
        },
      },
      distances: params.distances,
      pattern: params.pattern,
      decision: params.proceed ? 'proceed' : (params.pattern === 'none_found' ? 'fail' : 'retry'),
      final_coordinates: params.final_coordinates,
      screenshot_before_b64: params.screenshot_b64,
    };

    // Track pattern
    this.patternCounts[params.pattern]++;

    // Track discrepancies
    if (params.pattern === 'vision_agree_dom_far' || params.pattern === 'vision_agree_dom_very_far') {
      if (this.currentLog) {
        this.currentLog.stats.dom_vision_discrepancies++;
      }
    }
    if (params.pattern === 'vision_disagree') {
      if (this.currentLog) {
        this.currentLog.stats.vision_vision_discrepancies++;
      }
    }

    // Update API call counts
    if (this.currentLog) {
      this.currentLog.stats.dom_calls++;
      this.currentLog.stats.lux_calls++;
      this.currentLog.stats.gemini_calls++;
    }

    // Console output
    this.printVerificationToConsole(verification);

    return verification;
  }

  /**
   * Log a complete step execution
   */
  logStep(params: {
    step: PlanStep;
    verification: VerificationLog;
    success: boolean;
    error?: string;
    retries: number;
    used_fallback: boolean;
    duration_ms: number;
  }): void {
    const stepLog: StepLog = {
      step_number: params.step.step_number,
      action_type: params.step.action_type,
      target_description: params.step.target_description,
      verification: params.verification,
      execution: {
        success: params.success,
        error: params.error,
        retries: params.retries,
        used_fallback: params.used_fallback,
        duration_ms: params.duration_ms,
      },
      learned_data: params.success ? {
        dom_selector: params.step.dom_selector,
        verified_by: this.getVerifiedBy(params.verification),
        confidence: params.verification.final_coordinates ?
          this.calculateStepConfidence(params.verification) : 0,
      } : undefined,
    };

    this.stepLogs.push(stepLog);

    // Update stats
    if (this.currentLog) {
      this.currentLog.stats.total_steps++;
      if (params.success) {
        this.currentLog.stats.successful_steps++;
      } else {
        this.currentLog.stats.failed_steps++;
      }
      this.currentLog.stats.total_duration_ms += params.duration_ms;
    }

    // Console output
    console.log(`[LOG] Step ${stepLog.step_number}: ${params.success ? '✓' : '✗'} ${stepLog.action_type} - ${stepLog.target_description}`);
  }

  /**
   * Complete the execution log
   */
  completeExecution(status: 'completed' | 'failed' | 'partial'): ExecutionLog | null {
    if (!this.currentLog) return null;

    this.currentLog.completed_at = new Date().toISOString();
    this.currentLog.status = status;
    this.currentLog.steps = [...this.stepLogs];
    this.currentLog.stats.patterns = { ...this.patternCounts };

    if (this.currentLog.stats.total_steps > 0) {
      this.currentLog.stats.avg_step_duration_ms =
        this.currentLog.stats.total_duration_ms / this.currentLog.stats.total_steps;
    }

    // Print summary
    this.printSummaryToConsole();

    const log = { ...this.currentLog };
    return log;
  }

  /**
   * Get current log (for intermediate access)
   */
  getCurrentLog(): ExecutionLog | null {
    if (!this.currentLog) return null;
    return {
      ...this.currentLog,
      steps: [...this.stepLogs],
      stats: {
        ...this.currentLog.stats,
        patterns: { ...this.patternCounts },
      },
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private getVerifiedBy(verification: VerificationLog): ('dom' | 'lux' | 'gemini')[] {
    const sources: ('dom' | 'lux' | 'gemini')[] = [];
    if (verification.sources.dom?.found && verification.sources.dom.element_visible) {
      sources.push('dom');
    }
    if (verification.sources.lux.found) {
      sources.push('lux');
    }
    if (verification.sources.gemini.found) {
      sources.push('gemini');
    }
    return sources;
  }

  private calculateStepConfidence(verification: VerificationLog): number {
    switch (verification.pattern) {
      case 'all_agree': return 1.0;
      case 'vision_agree_dom_far': return 0.8;
      case 'dom_one_vision': return 0.75;
      case 'vision_only': return 0.7;
      default: return 0.5;
    }
  }

  private printVerificationToConsole(v: VerificationLog): void {
    const dom = v.sources.dom;
    const lux = v.sources.lux;
    const gemini = v.sources.gemini;

    console.log(`\n[VERIFY] "${v.target_description}"`);
    console.log(`  DOM:    ${dom?.found ? `(${dom.x}, ${dom.y}) visible=${dom.element_visible}` : 'NOT FOUND'} [${dom?.latency_ms ?? 0}ms]`);
    console.log(`  Lux:    ${lux.found ? `(${lux.x}, ${lux.y}) conf=${(lux.confidence * 100).toFixed(0)}%` : 'NOT FOUND'} [${lux.latency_ms}ms]`);
    console.log(`  Gemini: ${gemini.found ? `(${gemini.x}, ${gemini.y}) conf=${(gemini.confidence * 100).toFixed(0)}%` : 'NOT FOUND'} [${gemini.latency_ms}ms]`);
    console.log(`  Distances: D↔L=${v.distances.dom_lux.toFixed(0)}px D↔G=${v.distances.dom_gemini.toFixed(0)}px L↔G=${v.distances.lux_gemini.toFixed(0)}px`);
    console.log(`  Pattern: ${v.pattern} → ${v.decision.toUpperCase()}`);

    if (v.final_coordinates) {
      console.log(`  Final: (${v.final_coordinates.x}, ${v.final_coordinates.y}) from ${v.final_coordinates.source}`);
    }
  }

  private printSummaryToConsole(): void {
    if (!this.currentLog) return;

    const stats = this.currentLog.stats;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`EXECUTION SUMMARY: ${this.currentLog.execution_id}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Task: ${this.currentLog.task_description}`);
    console.log(`Mode: ${this.currentLog.mode}`);
    console.log(`Status: ${this.currentLog.status}`);
    console.log(`Duration: ${(stats.total_duration_ms / 1000).toFixed(1)}s`);
    console.log(`\nSteps: ${stats.successful_steps}/${stats.total_steps} successful`);
    console.log(`API Calls: DOM=${stats.dom_calls} Lux=${stats.lux_calls} Gemini=${stats.gemini_calls}`);
    console.log(`\nPattern Distribution:`);
    Object.entries(stats.patterns).forEach(([pattern, count]) => {
      if (count > 0) {
        console.log(`  ${pattern}: ${count}`);
      }
    });
    console.log(`\nDiscrepancies:`);
    console.log(`  DOM vs Vision: ${stats.dom_vision_discrepancies}`);
    console.log(`  Vision vs Vision: ${stats.vision_vision_discrepancies}`);
    console.log(`${'='.repeat(60)}\n`);
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

export const executionLogManager = new ExecutionLogManager();
