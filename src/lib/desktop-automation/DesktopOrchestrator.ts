// ============================================================
// DESKTOP ORCHESTRATOR
// Executes Lux tasks on desktop via tool_server.py
// Supports Actor, Thinker, and Tasker modes
// ============================================================

import { luxApiClient } from './LuxApiClient';
import { desktopToolServerClient } from './DesktopToolServerClient';
import {
  LuxMode,
  LuxAction,
  DesktopTaskConfig,
  DesktopTaskCallbacks,
  DesktopTaskResult,
  DesktopStepExecution,
  LUX_MODE_CONFIGS
} from './types';

export class DesktopOrchestrator {
  private aborted: boolean = false;
  private stepsExecuted: number = 0;
  private actionsLog: LuxAction[] = [];
  private startTime: number = 0;
  private callbacks: DesktopTaskCallbacks;

  constructor(callbacks: DesktopTaskCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Execute a desktop task based on configuration.
   * Routes to appropriate execution method based on mode.
   */
  async execute(config: DesktopTaskConfig): Promise<DesktopTaskResult> {
    this.aborted = false;
    this.stepsExecuted = 0;
    this.actionsLog = [];
    this.startTime = Date.now();

    this.log('info', `🖥️ Starting desktop automation - Mode: ${config.mode}`);
    this.log('info', `📋 Task: ${config.task_description}`);

    // Health check
    const health = await desktopToolServerClient.healthCheck();
    if (!health.online) {
      const errorResult: DesktopTaskResult = {
        success: false,
        message: 'tool_server.py non raggiungibile. Assicurati che sia in esecuzione sulla porta 8766.',
        mode: config.mode,
        stepsExecuted: 0,
        actionsLog: [],
        duration_ms: Date.now() - this.startTime,
        error: 'Tool server offline'
      };
      this.callbacks.onError?.(errorResult.message);
      return errorResult;
    }

    this.log('success', `✅ Tool server online (v${health.version || 'unknown'})`);

    try {
      // Route to appropriate execution method
      if (config.mode === 'tasker' && config.todos && config.todos.length > 0) {
        return await this.executeTasker(config);
      } else {
        return await this.executeActorThinker(config);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log('error', `❌ Execution failed: ${errorMsg}`);
      
      const result: DesktopTaskResult = {
        success: false,
        message: `Errore durante l'esecuzione: ${errorMsg}`,
        mode: config.mode,
        stepsExecuted: this.stepsExecuted,
        actionsLog: this.actionsLog,
        duration_ms: Date.now() - this.startTime,
        error: errorMsg
      };
      
      this.callbacks.onComplete?.(result);
      return result;
    }
  }

  /**
   * Execute Actor or Thinker mode.
   * Single loop until is_done or max steps reached.
   */
  private async executeActorThinker(config: DesktopTaskConfig): Promise<DesktopTaskResult> {
    const modeConfig = LUX_MODE_CONFIGS[config.mode];
    const maxSteps = config.config.max_steps || modeConfig.max_steps;
    
    this.log('info', `🎯 Executing ${config.mode} mode (max ${maxSteps} steps)`);

    let stepIndex = 0;
    let isDone = false;

    while (stepIndex < maxSteps && !isDone && !this.aborted) {
      // 1. Take screenshot
      const screenshotResult = await desktopToolServerClient.screenshotDesktop();
      if (!screenshotResult.success || !screenshotResult.screenshot) {
        this.log('error', 'Failed to capture screenshot');
        break;
      }

      this.callbacks.onScreenshot?.(screenshotResult.screenshot);

      // 2. Call Lux API
      const luxResponse = await luxApiClient.act(
        screenshotResult.screenshot,
        config.task_description,
        config.config.model || modeConfig.model,
        config.config.temperature ?? modeConfig.temperature
      );

      if (luxResponse.error) {
        this.log('error', `Lux API error: ${luxResponse.error}`);
        break;
      }

      if (luxResponse.reasoning) {
        this.log('info', `💭 ${luxResponse.reasoning}`);
      }

      isDone = luxResponse.is_done;

      // 3. Execute actions
      for (const action of luxResponse.actions) {
        if (this.aborted) break;
        
        const execution = await this.executeAction(action, stepIndex);
        this.stepsExecuted++;
        stepIndex++;

        this.callbacks.onStep?.(stepIndex, action);

        if (!execution.success) {
          this.log('warn', `Action ${action.type} failed: ${execution.error}`);
        }

        // Short delay between actions
        await this.sleep(300);
      }

      // Delay between API calls
      await this.sleep(500);
    }

    const result: DesktopTaskResult = {
      success: isDone || this.stepsExecuted > 0,
      message: isDone 
        ? `✅ Task completato con successo (${this.stepsExecuted} step)`
        : this.aborted 
          ? `⏹️ Esecuzione interrotta (${this.stepsExecuted} step)`
          : `⚠️ Max step raggiunto (${this.stepsExecuted}/${maxSteps})`,
      mode: config.mode,
      stepsExecuted: this.stepsExecuted,
      actionsLog: this.actionsLog,
      duration_ms: Date.now() - this.startTime
    };

    this.log('success', result.message);
    this.callbacks.onComplete?.(result);
    return result;
  }

  /**
   * Execute Tasker mode.
   * Iterates through todos, executing each as a sub-task.
   */
  private async executeTasker(config: DesktopTaskConfig): Promise<DesktopTaskResult> {
    const todos = config.todos || [];
    const maxStepsPerTodo = config.config.max_steps_per_todo || LUX_MODE_CONFIGS.tasker.max_steps_per_todo;

    this.log('info', `📝 Executing Tasker mode with ${todos.length} todos`);

    let completedTodos = 0;

    for (let todoIndex = 0; todoIndex < todos.length && !this.aborted; todoIndex++) {
      const todoDescription = todos[todoIndex];
      this.log('info', `\n📌 Todo ${todoIndex + 1}/${todos.length}: ${todoDescription}`);
      this.callbacks.onTodoStart?.(todoIndex, todoDescription);

      let stepIndex = 0;
      let isDone = false;

      while (stepIndex < maxStepsPerTodo && !isDone && !this.aborted) {
        // 1. Take screenshot
        const screenshotResult = await desktopToolServerClient.screenshotDesktop();
        if (!screenshotResult.success || !screenshotResult.screenshot) {
          this.log('error', 'Failed to capture screenshot');
          break;
        }

        this.callbacks.onScreenshot?.(screenshotResult.screenshot);

        // 2. Call Lux API with todo-specific task
        const taskForTodo = `Current objective: ${todoDescription}\n\nOverall context: ${config.task_description}`;
        
        const luxResponse = await luxApiClient.act(
          screenshotResult.screenshot,
          taskForTodo,
          config.config.model || 'lux-actor-1',
          config.config.temperature ?? 0.0
        );

        if (luxResponse.error) {
          this.log('error', `Lux API error: ${luxResponse.error}`);
          break;
        }

        if (luxResponse.reasoning) {
          this.log('info', `💭 ${luxResponse.reasoning}`);
        }

        isDone = luxResponse.is_done;

        // 3. Execute actions
        for (const action of luxResponse.actions) {
          if (this.aborted) break;

          const execution = await this.executeAction(action, this.stepsExecuted, todoIndex);
          this.stepsExecuted++;
          stepIndex++;

          this.callbacks.onStep?.(this.stepsExecuted, action);

          if (!execution.success) {
            this.log('warn', `Action ${action.type} failed: ${execution.error}`);
          }

          await this.sleep(300);
        }

        await this.sleep(500);
      }

      const todoSuccess = isDone;
      if (todoSuccess) {
        completedTodos++;
      }
      
      this.callbacks.onTodoComplete?.(todoIndex, todoDescription, todoSuccess);
      this.log(todoSuccess ? 'success' : 'warn', 
        todoSuccess 
          ? `✅ Todo ${todoIndex + 1} completato`
          : `⚠️ Todo ${todoIndex + 1} non completato (${stepIndex} step)`
      );
    }

    const result: DesktopTaskResult = {
      success: completedTodos === todos.length,
      message: completedTodos === todos.length
        ? `✅ Tutti i ${todos.length} todos completati (${this.stepsExecuted} step totali)`
        : this.aborted
          ? `⏹️ Esecuzione interrotta (${completedTodos}/${todos.length} todos)`
          : `⚠️ Completati ${completedTodos}/${todos.length} todos`,
      mode: 'tasker',
      stepsExecuted: this.stepsExecuted,
      todosCompleted: completedTodos,
      totalTodos: todos.length,
      actionsLog: this.actionsLog,
      duration_ms: Date.now() - this.startTime
    };

    this.log('success', result.message);
    this.callbacks.onComplete?.(result);
    return result;
  }

  /**
   * Execute a single Lux action.
   */
  private async executeAction(
    action: LuxAction, 
    stepIndex: number,
    todoIndex?: number
  ): Promise<DesktopStepExecution> {
    const startTime = Date.now();
    const execution: DesktopStepExecution = {
      stepIndex,
      todoIndex,
      action,
      success: false,
      duration_ms: 0
    };

    this.actionsLog.push(action);

    try {
      switch (action.type) {
        case 'click':
          if (action.coordinate) {
            const [x, y] = action.coordinate;
            const result = await desktopToolServerClient.clickDesktop(x, y);
            execution.success = result.success;
            execution.error = result.error;
            this.log('info', `🖱️ Click at (${x}, ${y}) - ${result.success ? '✓' : '✗'}`);
          } else {
            execution.error = 'No coordinates for click action';
          }
          break;

        case 'type':
          if (action.text) {
            const result = await desktopToolServerClient.typeDesktop(action.text);
            execution.success = result.success;
            execution.error = result.error;
            this.log('info', `⌨️ Type: "${action.text.slice(0, 20)}..." - ${result.success ? '✓' : '✗'}`);
          } else {
            execution.error = 'No text for type action';
          }
          break;

        case 'press':
          if (action.key) {
            const result = await desktopToolServerClient.keypressDesktop(action.key);
            execution.success = result.success;
            execution.error = result.error;
            this.log('info', `🔤 Press: ${action.key} - ${result.success ? '✓' : '✗'}`);
          } else {
            execution.error = 'No key for press action';
          }
          break;

        case 'scroll':
          const direction = action.direction || 'down';
          const amount = action.scroll_amount || 3;
          const scrollResult = await desktopToolServerClient.scrollDesktop(direction, amount);
          execution.success = scrollResult.success;
          execution.error = scrollResult.error;
          this.log('info', `📜 Scroll ${direction} - ${scrollResult.success ? '✓' : '✗'}`);
          break;

        case 'wait':
          const waitMs = action.duration_ms || 1000;
          await this.sleep(waitMs);
          execution.success = true;
          this.log('info', `⏱️ Wait ${waitMs}ms`);
          break;

        case 'done':
          execution.success = true;
          this.log('success', `🎉 Done: ${action.reason || 'Task completed'}`);
          break;

        case 'fail':
          execution.success = false;
          execution.error = action.reason || 'Task failed';
          this.log('error', `❌ Fail: ${execution.error}`);
          break;

        default:
          execution.error = `Unknown action type: ${action.type}`;
          this.log('warn', execution.error);
      }
    } catch (error) {
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      this.log('error', `Exception executing ${action.type}: ${execution.error}`);
    }

    execution.duration_ms = Date.now() - startTime;
    return execution;
  }

  /**
   * Stop the current execution.
   */
  stop(): void {
    this.aborted = true;
    this.log('warn', '⏹️ Stopping execution...');
  }

  /**
   * Log message with callback notification.
   */
  private log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    const prefix = {
      info: '📝',
      warn: '⚠️',
      error: '❌',
      success: '✅'
    }[level];
    
    console.log(`${prefix} [DesktopOrchestrator] ${message}`);
    this.callbacks.onLog?.(message, level);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Factory function for creating orchestrators
export function createDesktopOrchestrator(callbacks?: DesktopTaskCallbacks): DesktopOrchestrator {
  return new DesktopOrchestrator(callbacks);
}
