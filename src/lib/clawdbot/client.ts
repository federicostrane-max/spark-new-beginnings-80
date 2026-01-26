/**
 * Clawdbot Client
 *
 * HTTP client for Clawdbot Service browser automation.
 * Can connect directly (port 8767) or via Tool Server proxy (/proxy/clawdbot/).
 *
 * Usage:
 *   // Via Tool Server proxy (recommended for Web App)
 *   const client = new ClawdbotClient(toolServerUrl, securityToken);
 *
 *   // Direct connection (local development)
 *   const client = new ClawdbotClient('http://127.0.0.1:8767', '', true);
 */

import type {
  ClawdbotTask,
  ClawdbotTaskResult,
  ClawdbotAction,
  HealthResponse,
  TaskListResponse,
  NavigateParams,
  ClickParams,
  TypeParams,
  ScreenshotParams,
  SnapshotParams,
  WaitParams,
  HoverParams,
  ScrollParams,
  SelectParams,
  PressParams,
  DragParams,
  StorageParams,
  UploadParams,
  EvaluateParams,
} from './types';

export class ClawdbotClient {
  private baseUrl: string;
  private securityToken: string;
  private isDirect: boolean;

  /**
   * Create a new Clawdbot client
   *
   * @param baseUrl - Tool Server URL (e.g., https://xxx.ngrok.io) or direct Clawdbot URL
   * @param securityToken - Tool Server security token (X-Tool-Token)
   * @param isDirect - If true, connect directly to Clawdbot (no proxy)
   */
  constructor(baseUrl: string, securityToken: string, isDirect: boolean = false) {
    this.isDirect = isDirect;
    this.securityToken = securityToken;

    if (isDirect) {
      // Direct connection to Clawdbot Service
      this.baseUrl = baseUrl.replace(/\/$/, '');
    } else {
      // Via Tool Server proxy
      this.baseUrl = `${baseUrl.replace(/\/$/, '')}/proxy/clawdbot`;
    }
  }

  /**
   * Make an HTTP request to Clawdbot
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add security token if using proxy
    if (!this.isDirect && this.securityToken) {
      headers['X-Tool-Token'] = this.securityToken;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Clawdbot error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json();
  }

  // ============================================================================
  // Task Management
  // ============================================================================

  /**
   * Create and execute a new browser automation task
   */
  async createTask(
    action: ClawdbotAction,
    params: Record<string, unknown> = {},
    timeoutMs?: number
  ): Promise<ClawdbotTask> {
    return this.request<ClawdbotTask>('/task', {
      method: 'POST',
      body: JSON.stringify({
        action,
        params,
        timeout_ms: timeoutMs,
      }),
    });
  }

  /**
   * Get the status and messages of a task
   *
   * @param taskId - The task ID
   * @param since - Only return messages with id > since
   */
  async getTaskStatus(taskId: string, since: number = 0): Promise<ClawdbotTaskResult> {
    return this.request<ClawdbotTaskResult>(`/task/${taskId}/status?since=${since}`);
  }

  /**
   * Cancel a running task
   */
  async cancelTask(taskId: string): Promise<{ task_id: string; status: string; message: string }> {
    return this.request(`/task/${taskId}/cancel`, { method: 'POST' });
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<TaskListResponse> {
    return this.request<TaskListResponse>('/tasks');
  }

  /**
   * Get health status of Clawdbot Service
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  // ============================================================================
  // Navigation Actions
  // ============================================================================

  /**
   * Navigate to a URL
   */
  async navigate(url: string, targetId?: string): Promise<ClawdbotTask> {
    const params: NavigateParams = { url };
    if (targetId) params.targetId = targetId;
    return this.createTask('navigate', params);
  }

  // ============================================================================
  // Interaction Actions
  // ============================================================================

  /**
   * Click on an element by ref
   */
  async click(ref: string, options?: Omit<ClickParams, 'ref'>): Promise<ClawdbotTask> {
    return this.createTask('click', { ref, ...options });
  }

  /**
   * Type text into an element
   */
  async type(
    ref: string,
    text: string,
    options?: Omit<TypeParams, 'ref' | 'text'>
  ): Promise<ClawdbotTask> {
    return this.createTask('type', { ref, text, ...options });
  }

  /**
   * Hover over an element
   */
  async hover(ref: string, targetId?: string): Promise<ClawdbotTask> {
    const params: HoverParams = { ref };
    if (targetId) params.targetId = targetId;
    return this.createTask('hover', params);
  }

  /**
   * Scroll an element into view
   */
  async scroll(ref: string, targetId?: string): Promise<ClawdbotTask> {
    const params: ScrollParams = { ref };
    if (targetId) params.targetId = targetId;
    return this.createTask('scroll', params);
  }

  /**
   * Select option(s) in a dropdown
   */
  async select(ref: string, values: string[], targetId?: string): Promise<ClawdbotTask> {
    const params: SelectParams = { ref, values };
    if (targetId) params.targetId = targetId;
    return this.createTask('select', params);
  }

  /**
   * Press a key
   */
  async press(key: string, options?: Omit<PressParams, 'key'>): Promise<ClawdbotTask> {
    return this.createTask('press', { key, ...options });
  }

  /**
   * Drag from one element to another
   */
  async drag(from: string, to: string, targetId?: string): Promise<ClawdbotTask> {
    const params: DragParams = { from, to };
    if (targetId) params.targetId = targetId;
    return this.createTask('drag', params);
  }

  // ============================================================================
  // Capture Actions
  // ============================================================================

  /**
   * Take a screenshot
   */
  async screenshot(options?: ScreenshotParams): Promise<ClawdbotTask> {
    return this.createTask('screenshot', options || {});
  }

  /**
   * Get a DOM snapshot for AI analysis
   */
  async snapshot(mode: 'ai' | 'aria' = 'ai', options?: Omit<SnapshotParams, 'mode'>): Promise<ClawdbotTask> {
    return this.createTask('snapshot', { mode, ...options });
  }

  // ============================================================================
  // Wait Actions
  // ============================================================================

  /**
   * Wait for various conditions
   */
  async wait(options: WaitParams): Promise<ClawdbotTask> {
    return this.createTask('wait', options);
  }

  /**
   * Wait for a specific amount of time
   */
  async waitTime(ms: number): Promise<ClawdbotTask> {
    return this.wait({ timeMs: ms });
  }

  /**
   * Wait for text to appear
   */
  async waitForText(text: string): Promise<ClawdbotTask> {
    return this.wait({ text });
  }

  /**
   * Wait for a selector to appear
   */
  async waitForSelector(selector: string): Promise<ClawdbotTask> {
    return this.wait({ selector });
  }

  // ============================================================================
  // Storage Actions
  // ============================================================================

  /**
   * Get cookies
   */
  async getCookies(targetId?: string): Promise<ClawdbotTask> {
    return this.createTask('cookies_get', targetId ? { targetId } : {});
  }

  /**
   * Set cookies
   */
  async setCookies(cookies: unknown[], targetId?: string): Promise<ClawdbotTask> {
    return this.createTask('cookies_set', { cookies, targetId });
  }

  /**
   * Get local or session storage
   */
  async getStorage(type: 'local' | 'session', targetId?: string): Promise<ClawdbotTask> {
    const params: StorageParams = { type };
    if (targetId) params.targetId = targetId;
    return this.createTask('storage_get', params);
  }

  /**
   * Set local or session storage
   */
  async setStorage(
    type: 'local' | 'session',
    data: Record<string, unknown>,
    targetId?: string
  ): Promise<ClawdbotTask> {
    const params: StorageParams = { type, data };
    if (targetId) params.targetId = targetId;
    return this.createTask('storage_set', params);
  }

  // ============================================================================
  // Advanced Actions
  // ============================================================================

  /**
   * Upload files
   */
  async upload(files: string[], ref?: string, targetId?: string): Promise<ClawdbotTask> {
    const params: UploadParams = { files };
    if (ref) params.ref = ref;
    if (targetId) params.targetId = targetId;
    return this.createTask('upload', params);
  }

  /**
   * Execute JavaScript in the page
   */
  async evaluate(script: string, options?: Omit<EvaluateParams, 'script'>): Promise<ClawdbotTask> {
    return this.createTask('evaluate', { script, ...options });
  }
}

/**
 * Create a Clawdbot client using Tool Server proxy
 */
export function createClawdbotClient(
  toolServerUrl: string,
  securityToken: string
): ClawdbotClient {
  return new ClawdbotClient(toolServerUrl, securityToken, false);
}

/**
 * Create a direct Clawdbot client (for local development)
 */
export function createDirectClawdbotClient(
  clawdbotUrl: string = 'http://127.0.0.1:8767'
): ClawdbotClient {
  return new ClawdbotClient(clawdbotUrl, '', true);
}
