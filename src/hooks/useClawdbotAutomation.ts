/**
 * useClawdbotAutomation Hook
 *
 * React hook for browser automation via Clawdbot Service.
 * Handles task creation, polling, and real-time message updates.
 *
 * @example
 * const {
 *   navigate,
 *   click,
 *   type,
 *   screenshot,
 *   snapshot,
 *   messages,
 *   isRunning,
 *   error,
 *   taskResult
 * } = useClawdbotAutomation({
 *   toolServerUrl: 'https://xxx.ngrok.io',
 *   securityToken: 'abc123...'
 * });
 *
 * // Execute navigation
 * await navigate('https://example.com');
 *
 * // Type in a field
 * await type('e5', 'hello@example.com');
 *
 * // Click a button
 * await click('e8');
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ClawdbotClient,
  createClawdbotClient,
  type ClawdbotTask,
  type ClawdbotTaskResult,
  type ClawdbotAction,
  type TaskMessage,
  type WaitParams,
} from '@/lib/clawdbot';

interface UseClawdbotOptions {
  /** Tool Server URL (e.g., https://xxx.ngrok.io) */
  toolServerUrl: string;
  /** Tool Server security token */
  securityToken: string;
  /** Polling interval in milliseconds (default: 500) */
  pollingIntervalMs?: number;
  /** Auto-start polling when task is created (default: true) */
  autoStartPolling?: boolean;
}

interface UseClawdbotReturn {
  /** Clawdbot client instance */
  client: ClawdbotClient;
  /** Current task being executed */
  currentTask: ClawdbotTask | null;
  /** Final result of the completed task */
  taskResult: ClawdbotTaskResult | null;
  /** Messages from the current task */
  messages: TaskMessage[];
  /** Whether a task is currently running */
  isRunning: boolean;
  /** Error message if task failed */
  error: string | null;

  // === Task Management ===
  /** Execute any action */
  executeAction: (action: ClawdbotAction, params?: Record<string, unknown>) => Promise<ClawdbotTask>;
  /** Cancel the current task */
  cancelCurrentTask: () => Promise<void>;
  /** Clear messages and reset state */
  reset: () => void;

  // === Navigation ===
  /** Navigate to a URL */
  navigate: (url: string) => Promise<ClawdbotTask>;

  // === Interactions ===
  /** Click on an element by ref */
  click: (ref: string, options?: { doubleClick?: boolean }) => Promise<ClawdbotTask>;
  /** Type text into an element */
  type: (ref: string, text: string, options?: { submit?: boolean }) => Promise<ClawdbotTask>;
  /** Hover over an element */
  hover: (ref: string) => Promise<ClawdbotTask>;
  /** Scroll element into view */
  scroll: (ref: string) => Promise<ClawdbotTask>;
  /** Press a key */
  press: (key: string) => Promise<ClawdbotTask>;

  // === Capture ===
  /** Take a screenshot */
  screenshot: (options?: { fullPage?: boolean }) => Promise<ClawdbotTask>;
  /** Get DOM snapshot */
  snapshot: (mode?: 'ai' | 'aria') => Promise<ClawdbotTask>;

  // === Wait ===
  /** Wait for various conditions */
  wait: (options: WaitParams) => Promise<ClawdbotTask>;
  /** Wait for specific time */
  waitTime: (ms: number) => Promise<ClawdbotTask>;
  /** Wait for text to appear */
  waitForText: (text: string) => Promise<ClawdbotTask>;
}

export function useClawdbotAutomation(options: UseClawdbotOptions): UseClawdbotReturn {
  const {
    toolServerUrl,
    securityToken,
    pollingIntervalMs = 500,
    autoStartPolling = true,
  } = options;

  // Create client
  const client = useMemo(
    () => createClawdbotClient(toolServerUrl, securityToken),
    [toolServerUrl, securityToken]
  );

  // State
  const [currentTask, setCurrentTask] = useState<ClawdbotTask | null>(null);
  const [taskResult, setTaskResult] = useState<ClawdbotTaskResult | null>(null);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for polling
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageIdRef = useRef(0);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Poll for task status updates
  const pollTaskStatus = useCallback(
    async (taskId: string) => {
      try {
        const result = await client.getTaskStatus(taskId, lastMessageIdRef.current);

        // Add new messages
        if (result.messages && result.messages.length > 0) {
          setMessages((prev) => [...prev, ...result.messages]);
          const maxId = Math.max(...result.messages.map((m) => m.id));
          lastMessageIdRef.current = maxId;
        }

        // Check if task completed
        if (['completed', 'failed', 'cancelled'].includes(result.status)) {
          setTaskResult(result);
          setIsRunning(false);
          stopPolling();

          if (result.status === 'failed' && result.error) {
            setError(result.error);
          }
        }
      } catch (err) {
        console.error('[useClawdbotAutomation] Polling error:', err);
        // Don't stop polling on transient errors
      }
    },
    [client, stopPolling]
  );

  // Execute an action
  const executeAction = useCallback(
    async (action: ClawdbotAction, params: Record<string, unknown> = {}) => {
      // Reset state
      setError(null);
      setMessages([]);
      setTaskResult(null);
      lastMessageIdRef.current = 0;
      stopPolling();

      try {
        const task = await client.createTask(action, params);
        setCurrentTask(task);
        setIsRunning(true);

        // Start polling if auto-start enabled
        if (autoStartPolling) {
          pollingRef.current = setInterval(() => {
            pollTaskStatus(task.task_id);
          }, pollingIntervalMs);
        }

        return task;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create task';
        setError(errorMessage);
        setIsRunning(false);
        throw err;
      }
    },
    [client, autoStartPolling, pollingIntervalMs, pollTaskStatus, stopPolling]
  );

  // Cancel current task
  const cancelCurrentTask = useCallback(async () => {
    if (currentTask && isRunning) {
      try {
        await client.cancelTask(currentTask.task_id);
      } catch (err) {
        console.error('[useClawdbotAutomation] Cancel error:', err);
      }
      setIsRunning(false);
      stopPolling();
    }
  }, [client, currentTask, isRunning, stopPolling]);

  // Reset state
  const reset = useCallback(() => {
    stopPolling();
    setCurrentTask(null);
    setTaskResult(null);
    setMessages([]);
    setIsRunning(false);
    setError(null);
    lastMessageIdRef.current = 0;
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Convenience methods
  const navigate = useCallback(
    (url: string) => executeAction('navigate', { url }),
    [executeAction]
  );

  const click = useCallback(
    (ref: string, options?: { doubleClick?: boolean }) =>
      executeAction('click', { ref, ...options }),
    [executeAction]
  );

  const type = useCallback(
    (ref: string, text: string, options?: { submit?: boolean }) =>
      executeAction('type', { ref, text, ...options }),
    [executeAction]
  );

  const hover = useCallback(
    (ref: string) => executeAction('hover', { ref }),
    [executeAction]
  );

  const scroll = useCallback(
    (ref: string) => executeAction('scroll', { ref }),
    [executeAction]
  );

  const press = useCallback(
    (key: string) => executeAction('press', { key }),
    [executeAction]
  );

  const screenshot = useCallback(
    (options?: { fullPage?: boolean }) => executeAction('screenshot', options || {}),
    [executeAction]
  );

  const snapshot = useCallback(
    (mode: 'ai' | 'aria' = 'ai') => executeAction('snapshot', { mode }),
    [executeAction]
  );

  const wait = useCallback(
    (options: WaitParams) => executeAction('wait', options),
    [executeAction]
  );

  const waitTime = useCallback(
    (ms: number) => executeAction('wait', { timeMs: ms }),
    [executeAction]
  );

  const waitForText = useCallback(
    (text: string) => executeAction('wait', { text }),
    [executeAction]
  );

  return {
    client,
    currentTask,
    taskResult,
    messages,
    isRunning,
    error,
    executeAction,
    cancelCurrentTask,
    reset,
    navigate,
    click,
    type,
    hover,
    scroll,
    press,
    screenshot,
    snapshot,
    wait,
    waitTime,
    waitForText,
  };
}

export default useClawdbotAutomation;
