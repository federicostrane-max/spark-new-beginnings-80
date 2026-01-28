/**
 * Claude Launcher Desktop App API Client
 *
 * HTTP client for interacting with the Claude Launcher Desktop App.
 * Default endpoint: http://localhost:3847
 */

import type {
  SessionMetadata,
  SearchResult,
  ApiDocsResponse,
  SearchResponse,
  SessionMessagesResponse,
  BulkMetadataResponse,
  RestartResponse,
} from './types';

export class LauncherClient {
  private baseUrl: string;
  private apiToken: string;

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
  // Search
  // ============================================================================

  /**
   * Search sessions globally
   *
   * @param query - Search query string
   * @param limit - Maximum number of results (optional)
   */
  async searchSessions(query: string, limit?: number): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (limit !== undefined) {
      params.append('limit', limit.toString());
    }
    return this.request<SearchResponse>(`/api/search?${params.toString()}`);
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
  // Session Messages
  // ============================================================================

  /**
   * Get last N messages from a session
   *
   * @param sessionId - Session ID
   * @param limit - Maximum number of messages (optional)
   */
  async getSessionMessages(
    sessionId: string,
    limit?: number
  ): Promise<SessionMessagesResponse> {
    const params = new URLSearchParams();
    if (limit !== undefined) {
      params.append('limit', limit.toString());
    }
    const queryString = params.toString();
    const path = `/api/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    return this.request<SessionMessagesResponse>(path);
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Get all session metadata (bulk)
   */
  async getAllMetadata(): Promise<BulkMetadataResponse> {
    return this.request<BulkMetadataResponse>('/api/metadata');
  }

  // ============================================================================
  // App Control
  // ============================================================================

  /**
   * Restart the app in dev mode
   */
  async restartDevApp(): Promise<RestartResponse> {
    return this.request<RestartResponse>('/api/app/restart-dev', {
      method: 'POST',
    });
  }
}

/**
 * Create a Launcher client with default configuration
 */
export function createLauncherClient(
  baseUrl: string = 'http://localhost:3847',
  apiToken: string = ''
): LauncherClient {
  return new LauncherClient(baseUrl, apiToken);
}
