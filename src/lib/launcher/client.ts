/**
 * Claude Launcher Desktop App API Client
 *
 * HTTP client for interacting with the Claude Launcher Desktop App.
 * Default endpoint: http://localhost:3847
 */

import type {
  SessionMetadata,
  TerminalSession,
  ParsedMessage,
  SessionSearchResult,
  ApiDocsResponse,
  SearchResponse,
  SessionMessagesResponse,
  BulkMetadataResponse,
  RestartResponse,
  OrchestrationStatus,
  OrchestrationEvent,
  WebhookConfig,
  BroadcastResponse,
  SessionsListResponse,
  CreateSessionResponse,
  SendMessageResponse,
  WebhooksListResponse,
} from './types';

export class LauncherClient {
  private baseUrl: string;
  private apiToken: string;
  private eventSource: EventSource | null = null;

  /**
   * Create a new Launcher client
   *
   * @param baseUrl - API base URL (default: http://localhost:3847)
   * @param apiToken - API authentication token
   */
  constructor(baseUrl: string = 'http://localhost:3847', apiToken: string = '') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiToken = apiToken;
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the API token
   */
  getToken(): string {
    return this.apiToken;
  }

  /**
   * Set the API token
   */
  setApiToken(token: string): void {
    this.apiToken = token;
  }

  /**
   * Make an HTTP request to the Launcher API
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiToken) {
      headers['X-API-Token'] = this.apiToken;
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
        `Launcher API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json();
  }

  // ============================================================================
  // Documentation
  // ============================================================================

  /**
   * Get API auto-documentation
   */
  async getDocs(): Promise<ApiDocsResponse> {
    return this.request<ApiDocsResponse>('/api/docs');
  }

  // ============================================================================
  // Sessions
  // ============================================================================

  /**
   * Get all active sessions
   */
  async getSessions(): Promise<TerminalSession[]> {
    const response = await this.request<SessionsListResponse>('/api/sessions');
    return response.sessions;
  }

  /**
   * Create a new session
   *
   * @param projectPath - Path to the project
   * @param sessionType - 'new' or 'resume' (optional)
   * @param sessionName - Custom session name (optional)
   */
  async createSession(
    projectPath: string,
    sessionType: 'new' | 'resume' = 'new',
    sessionName?: string
  ): Promise<TerminalSession> {
    const response = await this.request<CreateSessionResponse>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectPath,
        sessionType,
        sessionName,
      }),
    });
    return response.session;
  }

  /**
   * Send a message to a session
   *
   * @param sessionId - Session ID
   * @param message - Message content
   * @param files - Optional file paths to attach
   */
  async sendMessage(
    sessionId: string,
    message: string,
    files?: string[]
  ): Promise<void> {
    await this.request<SendMessageResponse>(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        files,
      }),
    });
  }

  /**
   * Get last N messages from a session
   *
   * @param sessionId - Session ID
   * @param limit - Maximum number of messages (optional)
   */
  async getSessionMessages(
    sessionId: string,
    limit?: number
  ): Promise<ParsedMessage[]> {
    const params = new URLSearchParams();
    if (limit !== undefined) {
      params.append('limit', limit.toString());
    }
    const queryString = params.toString();
    const path = `/api/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    const response = await this.request<SessionMessagesResponse>(path);
    return response.messages;
  }

  // ============================================================================
  // Search
  // ============================================================================

  /**
   * Search sessions globally
   *
   * @param query - Search query string
   * @param limit - Maximum number of results (optional)
   */
  async searchSessions(query: string, limit?: number): Promise<SessionSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (limit !== undefined) {
      params.append('limit', limit.toString());
    }
    const response = await this.request<SearchResponse>(`/api/search?${params.toString()}`);
    return response.results;
  }

  // ============================================================================
  // Session Metadata
  // ============================================================================

  /**
   * Get metadata for a specific session
   *
   * @param sessionId - Session ID
   */
  async getSessionMetadata(sessionId: string): Promise<SessionMetadata> {
    return this.request<SessionMetadata>(`/api/sessions/${sessionId}/metadata`);
  }

  /**
   * Update metadata for a specific session
   *
   * @param sessionId - Session ID
   * @param data - Partial metadata to update
   */
  async updateSessionMetadata(
    sessionId: string,
    data: Partial<SessionMetadata>
  ): Promise<SessionMetadata> {
    return this.request<SessionMetadata>(`/api/sessions/${sessionId}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Get all session metadata (bulk)
   */
  async getAllMetadata(): Promise<Record<string, SessionMetadata>> {
    const response = await this.request<BulkMetadataResponse>('/api/metadata');
    return response.metadata;
  }

  // ============================================================================
  // Orchestration
  // ============================================================================

  /**
   * Get orchestration status (all sessions overview)
   */
  async getOrchestrationStatus(): Promise<OrchestrationStatus> {
    return this.request<OrchestrationStatus>('/api/orchestration/status');
  }

  /**
   * Broadcast a message to multiple sessions
   *
   * @param message - Message to broadcast
   * @param filter - Optional filter for target sessions
   */
  async broadcastMessage(
    message: string,
    filter?: { status?: string; projectPath?: string }
  ): Promise<BroadcastResponse> {
    return this.request<BroadcastResponse>('/api/orchestration/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        message,
        filter,
      }),
    });
  }

  /**
   * Subscribe to orchestration events via SSE
   *
   * @param onEvent - Callback for each event
   * @returns Unsubscribe function
   */
  subscribeToEvents(
    onEvent: (event: OrchestrationEvent) => void
  ): () => void {
    // Close existing connection if any
    if (this.eventSource) {
      this.eventSource.close();
    }

    const url = new URL(`${this.baseUrl}/api/orchestration/events`);
    if (this.apiToken) {
      url.searchParams.set('token', this.apiToken);
    }

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as OrchestrationEvent;
        onEvent(parsed);
      } catch (error) {
        console.error('[LauncherClient] Failed to parse event:', error);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('[LauncherClient] SSE error:', error);
    };

    // Return unsubscribe function
    return () => {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    };
  }

  // ============================================================================
  // Webhooks
  // ============================================================================

  /**
   * Get all registered webhooks
   */
  async getWebhooks(): Promise<WebhookConfig[]> {
    const response = await this.request<WebhooksListResponse>('/api/webhooks');
    return response.webhooks;
  }

  /**
   * Create a new webhook
   *
   * @param config - Webhook configuration
   */
  async createWebhook(
    config: Omit<WebhookConfig, 'id' | 'createdAt' | 'failureCount'>
  ): Promise<WebhookConfig> {
    return this.request<WebhookConfig>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  /**
   * Delete a webhook
   *
   * @param id - Webhook ID
   */
  async deleteWebhook(id: string): Promise<void> {
    await this.request<void>(`/api/webhooks/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================================================
  // App Control
  // ============================================================================

  /**
   * Restart the app in dev mode
   */
  async restartDev(): Promise<RestartResponse> {
    return this.request<RestartResponse>('/api/app/restart-dev', {
      method: 'POST',
    });
  }

  /**
   * Wait for the app to restart and become available
   *
   * @param maxWaitMs - Maximum wait time in milliseconds (default: 30000)
   */
  async waitForRestart(maxWaitMs: number = 30000): Promise<{ success: boolean }> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        await this.getDocs();
        return { success: true };
      } catch {
        // Server not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
    }

    return { success: false };
  }
}

// ============================================================================
// Singleton Instance & Factory
// ============================================================================

let launcherClientInstance: LauncherClient | null = null;

/**
 * Get the singleton LauncherClient instance
 */
export function getLauncherClient(): LauncherClient {
  if (!launcherClientInstance) {
    // Try to load config from localStorage
    const savedUrl = localStorage.getItem('launcher_api_url');
    const savedToken = localStorage.getItem('launcher_api_token');
    
    launcherClientInstance = new LauncherClient(
      savedUrl || 'http://localhost:3847',
      savedToken || ''
    );
  }
  return launcherClientInstance;
}

/**
 * Configure the singleton LauncherClient
 */
export function configureLauncherClient(baseUrl: string, apiToken: string): void {
  localStorage.setItem('launcher_api_url', baseUrl);
  localStorage.setItem('launcher_api_token', apiToken);
  
  launcherClientInstance = new LauncherClient(baseUrl, apiToken);
}

/**
 * Create a new Launcher client (factory function)
 */
export function createLauncherClient(
  baseUrl: string = 'http://localhost:3847',
  apiToken: string = ''
): LauncherClient {
  return new LauncherClient(baseUrl, apiToken);
}
