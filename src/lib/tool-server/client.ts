// ============================================================
// HTTP Client per Tool Server (127.0.0.1:8766)
// ============================================================

import { DEFAULT_CONFIG, ToolServerConfig, ToolServerResponse } from './types';

class ToolServerClient {
  private timeout: number;

  constructor(config: Partial<ToolServerConfig> = {}) {
    // Non memorizzare baseUrl - verrà calcolato dinamicamente ad ogni richiesta
    this.timeout = config.timeout ?? DEFAULT_CONFIG.timeout;
  }

  // ──────────────────────────────────────────────────────────
  // URL Configuration (localStorage > env > default)
  // Chiamato AD OGNI richiesta per leggere sempre il valore corrente
  // ──────────────────────────────────────────────────────────

  private getBaseUrl(): string {
    // 1. localStorage (URL ngrok configurato dall'utente)
    if (typeof window !== 'undefined') {
      const savedUrl = localStorage.getItem('toolServerUrl');
      if (savedUrl && savedUrl.trim()) {
        return savedUrl.trim();
      }
    }
    
    // 2. Variabile d'ambiente (per sviluppo locale)
    const envUrl = import.meta.env.VITE_TOOL_SERVER_URL;
    if (envUrl) {
      return envUrl;
    }
    
    // 3. Default localhost
    return 'http://127.0.0.1:8766';
  }

  // Salva solo in localStorage - la prossima richiesta userà automaticamente il nuovo URL
  public updateBaseUrl(newUrl: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('toolServerUrl', newUrl);
    }
  }

  // Ritorna sempre il valore corrente (dinamico)
  public getConfiguredUrl(): string {
    return this.getBaseUrl();
  }

  public async testConnection(): Promise<{
    connected: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      const baseUrl = this.getBaseUrl(); // Legge dinamicamente ad ogni chiamata
      const response = await fetch(`${baseUrl}/status`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        return { connected: false, error: `HTTP ${response.status}` };
      }
      
      const data = await response.json();
      return { connected: true, version: data.version };
    } catch (error) {
      return { 
        connected: false, 
        error: error instanceof Error ? error.message : 'Connection failed' 
      };
    }
  }

  // ──────────────────────────────────────────────────────────
  // HTTP Methods
  // ──────────────────────────────────────────────────────────

  private async request<T = ToolServerResponse>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const baseUrl = this.getBaseUrl(); // Legge dinamicamente ad ogni richiesta
    const url = `${baseUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Tool Server error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Tool Server timeout - verifica che sia in esecuzione');
      }
      
      throw error;
    }
  }

  private async get<T = ToolServerResponse>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  private async post<T = ToolServerResponse>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ──────────────────────────────────────────────────────────
  // Health Check
  // ──────────────────────────────────────────────────────────

  async checkHealth(): Promise<boolean> {
    try {
      const result = await this.get<{ status: string }>('/health');
      return result.status === 'healthy';
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Browser Session Management
  // ──────────────────────────────────────────────────────────

  async browserStart(startUrl: string, options?: {
    headless?: boolean;
    viewport_width?: number;
    viewport_height?: number;
  }): Promise<{ session_id: string; success: boolean }> {
    // Tool Server v8.4.1: viewport = lux_sdk (1260×700)
    return this.post('/browser/start', {
      start_url: startUrl,
      headless: options?.headless ?? false,
      viewport_width: options?.viewport_width ?? 1260,
      viewport_height: options?.viewport_height ?? 700,
    });
  }

  async browserStop(sessionId: string): Promise<ToolServerResponse> {
    return this.post('/browser/stop', { session_id: sessionId });
  }

  async browserNavigate(sessionId: string, url: string): Promise<ToolServerResponse> {
    return this.post('/browser/navigate', { session_id: sessionId, url });
  }

  async getCurrentUrl(sessionId: string): Promise<{ url: string; success: boolean }> {
    return this.get(`/browser/current_url?session_id=${sessionId}`);
  }

  // ──────────────────────────────────────────────────────────
  // DOM / Accessibility Tree
  // ──────────────────────────────────────────────────────────

  async getDomTree(sessionId: string): Promise<{ 
    success: boolean;
    tree: Record<string, unknown> | null;
    url?: string;
    error?: string;
  }> {
    return this.get(`/browser/dom/tree?session_id=${sessionId}`);
  }

  async getElementRect(options: {
    session_id: string;
    selector?: string;
    text?: string;
    role?: string;
    test_id?: string;
    label?: string;
    placeholder?: string;
  }): Promise<{
    success: boolean;
    found: boolean;
    visible: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    bounding_box?: { x: number; y: number; width: number; height: number };
  }> {
    return this.post('/browser/dom/element_rect', options);
  }

  // ──────────────────────────────────────────────────────────
  // Screenshot
  // ──────────────────────────────────────────────────────────

  async screenshot(options: {
    scope: 'browser' | 'desktop';
    session_id?: string;
    optimize_for?: 'lux' | 'gemini';
  }): Promise<{
    success: boolean;
    original: { image_base64: string; width: number; height: number };
    lux_optimized?: { image_base64: string; width: number; height: number };
  }> {
    return this.post('/screenshot', options);
  }

  // ──────────────────────────────────────────────────────────
  // Actions
  // ──────────────────────────────────────────────────────────

  async click(options: {
    scope: 'browser' | 'desktop';
    x: number;
    y: number;
    session_id?: string;
    coordinate_origin?: 'viewport' | 'lux_sdk' | 'normalized';
    click_type?: 'single' | 'double' | 'right';
  }): Promise<ToolServerResponse> {
    // Tool Server v8.4.1: viewport = lux_sdk (1:1), 'normalized' for Gemini raw coords
    return this.post('/click', {
      scope: options.scope,
      x: options.x,
      y: options.y,
      session_id: options.session_id,
      coordinate_origin: options.coordinate_origin ?? 'viewport',
      click_type: options.click_type ?? 'single',
    });
  }

  async type(options: {
    scope: 'browser' | 'desktop';
    text: string;
    session_id?: string;
    method?: 'keystrokes' | 'clipboard';
  }): Promise<ToolServerResponse> {
    return this.post('/type', {
      scope: options.scope,
      text: options.text,
      session_id: options.session_id,
      method: options.method ?? 'clipboard',
    });
  }

  async scroll(options: {
    scope: 'browser' | 'desktop';
    direction: 'up' | 'down';
    amount?: number;
    session_id?: string;
  }): Promise<ToolServerResponse> {
    return this.post('/scroll', {
      scope: options.scope,
      direction: options.direction,
      amount: options.amount ?? 500,
      session_id: options.session_id,
    });
  }

  async keypress(options: {
    scope: 'browser' | 'desktop';
    keys: string;
    session_id?: string;
  }): Promise<ToolServerResponse> {
    return this.post('/keypress', {
      scope: options.scope,
      keys: options.keys,
      session_id: options.session_id,
    });
  }
}

// Singleton instance
export const toolServerClient = new ToolServerClient();

// Export class for custom instances
export { ToolServerClient };
