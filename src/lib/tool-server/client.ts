// ============================================================
// HTTP Client per Tool Server (ngrok URL configurato dall'utente)
// CRITICAL: MAI fallback a localhost - se non configurato, errore!
// ============================================================

import { DEFAULT_CONFIG, ToolServerConfig, ToolServerResponse } from './types';

// ──────────────────────────────────────────────────────────
// URL Normalization Helper (EXPORTED per riuso)
// ──────────────────────────────────────────────────────────

export function normalizeToolServerUrl(input: string): string {
  if (!input) return '';
  let url = input.trim();
  // Rimuove trailing slash
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  return url;
}

// ──────────────────────────────────────────────────────────
// Tool Server URL Change Event
// ──────────────────────────────────────────────────────────

export const TOOL_SERVER_URL_CHANGED_EVENT = 'toolServerUrlChanged';

// ──────────────────────────────────────────────────────────
// Headers comuni per tutte le richieste
// CRITICAL: ngrok-skip-browser-warning bypassa la pagina di warning
// ──────────────────────────────────────────────────────────
const COMMON_HEADERS = {
  'Accept': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};

class ToolServerClient {
  private timeout: number;

  constructor(config: Partial<ToolServerConfig> = {}) {
    // Non memorizzare baseUrl - verrà calcolato dinamicamente ad ogni richiesta
    this.timeout = config.timeout ?? DEFAULT_CONFIG.timeout;
  }

  // ──────────────────────────────────────────────────────────
  // URL Configuration (localStorage > env > NULL)
  // CRITICAL: Ritorna NULL se non configurato, MAI localhost!
  // ──────────────────────────────────────────────────────────

  private getBaseUrl(): string | null {
    // 1. localStorage (URL ngrok configurato dall'utente)
    if (typeof window !== 'undefined') {
      const savedUrl = localStorage.getItem('toolServerUrl');
      const normalized = normalizeToolServerUrl(savedUrl || '');
      if (normalized) {
        return normalized;
      }
    }
    
    // 2. Variabile d'ambiente (per sviluppo locale)
    const envUrl = import.meta.env.VITE_TOOL_SERVER_URL;
    if (envUrl) {
      const normalized = normalizeToolServerUrl(envUrl);
      if (normalized) return normalized;
    }
    
    // 3. NESSUN FALLBACK A LOCALHOST - ritorna null
    return null;
  }

  // Helper interno: lancia errore se non configurato
  private getBaseUrlOrThrow(): string {
    const url = this.getBaseUrl();
    if (!url) {
      throw new Error('Tool Server non configurato. Apri le impostazioni e salva il tuo URL ngrok.');
    }
    return url;
  }

  // Verifica se c'è un URL configurato
  public isConfigured(): boolean {
    return this.getBaseUrl() !== null;
  }

  // Salva in localStorage + emette evento per aggiornamento immediato UI
  public updateBaseUrl(newUrl: string): void {
    if (typeof window !== 'undefined') {
      const normalized = normalizeToolServerUrl(newUrl);
      if (normalized) {
        localStorage.setItem('toolServerUrl', normalized);
      } else {
        localStorage.removeItem('toolServerUrl');
      }
      // Emetti evento per aggiornamento immediato della UI
      window.dispatchEvent(new CustomEvent(TOOL_SERVER_URL_CHANGED_EVENT, { 
        detail: { url: normalized || null } 
      }));
    }
  }

  // Ritorna URL configurato o null se non configurato
  public getConfiguredUrl(): string | null {
    return this.getBaseUrl();
  }

  // CRITICAL: Se non configurato, ritorna errore SENZA fare fetch
  public async testConnection(): Promise<{
    connected: boolean;
    version?: string;
    error?: string;
    urlUsed?: string | null;
  }> {
    const baseUrl = this.getBaseUrl();
    
    // Se non configurato, ritorna subito senza fare fetch
    if (!baseUrl) {
      return { 
        connected: false, 
        error: 'Tool Server non configurato', 
        urlUsed: null 
      };
    }
    
    try {
      const response = await fetch(`${baseUrl}/status`, {
        method: 'GET',
        headers: { ...COMMON_HEADERS }
      });
      
      if (!response.ok) {
        return { connected: false, error: `HTTP ${response.status}`, urlUsed: baseUrl };
      }
      
      const data = await response.json();
      return { connected: true, version: data.version, urlUsed: baseUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      return { 
        connected: false, 
        error: `${errorMessage} (URL: ${baseUrl})`,
        urlUsed: baseUrl
      };
    }
  }

  // ──────────────────────────────────────────────────────────
  // HTTP Methods - CRITICAL: usa getBaseUrlOrThrow()
  // ──────────────────────────────────────────────────────────

  private async request<T = ToolServerResponse>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Lancia errore se non configurato - NESSUNA fetch a localhost
    const baseUrl = this.getBaseUrlOrThrow();
    const url = `${baseUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...COMMON_HEADERS,
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Tool Server error: ${response.status} ${response.statusText} (URL: ${baseUrl})`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Tool Server timeout (URL: ${baseUrl}) - verifica che ngrok sia in esecuzione`);
      }
      
      // Aggiungi URL all'errore per debugging
      if (error instanceof Error && !error.message.includes('URL:')) {
        throw new Error(`${error.message} (URL: ${baseUrl})`);
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

  /**
   * Get page snapshot in text format (Playwright MCP style).
   * Returns a concise text representation of interactive elements with ref IDs.
   * Much better for LLM consumption than full DOM tree.
   */
  async getSnapshot(sessionId: string): Promise<{
    success: boolean;
    url?: string;
    title?: string;
    snapshot: string;  // Text representation like "- button 'Submit' [ref=e3]"
    ref_count: number;
    error?: string;
  }> {
    return this.get(`/browser/snapshot?session_id=${sessionId}&format=text`);
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
    include_snapshot?: boolean;  // DEPRECATED v10.2.0: snapshot always included for browser actions
  }): Promise<ToolServerResponse & { snapshot?: string; snapshot_url?: string; snapshot_title?: string; snapshot_ref_count?: number }> {
    // Tool Server v8.4.1: viewport = lux_sdk (1:1), 'normalized' for Gemini raw coords
    return this.post('/click', {
      scope: options.scope,
      x: options.x,
      y: options.y,
      session_id: options.session_id,
      coordinate_origin: options.coordinate_origin ?? 'viewport',
      click_type: options.click_type ?? 'single',
      include_snapshot: options.include_snapshot ?? false,
    });
  }

  /**
   * Click element by ref ID (from dom_tree/snapshot).
   * No coordinates needed - uses ref from snapshot like "e3".
   */
  async clickByRef(options: {
    session_id: string;
    ref: string;  // e.g., "e3"
    click_type?: 'single' | 'double' | 'right';
    include_snapshot?: boolean;  // DEPRECATED v10.2.0: snapshot always included for browser actions
  }): Promise<ToolServerResponse & { snapshot?: string; snapshot_url?: string; snapshot_title?: string; snapshot_ref_count?: number }> {
    return this.post('/click_by_ref', {
      session_id: options.session_id,
      ref: options.ref,
      click_type: options.click_type ?? 'single',
      include_snapshot: options.include_snapshot ?? false,
    });
  }

  async type(options: {
    scope: 'browser' | 'desktop';
    text: string;
    session_id?: string;
    method?: 'keystrokes' | 'clipboard';
    include_snapshot?: boolean;  // DEPRECATED v10.2.0: snapshot always included for browser actions
  }): Promise<ToolServerResponse & { snapshot?: string; snapshot_url?: string; snapshot_title?: string; snapshot_ref_count?: number }> {
    return this.post('/type', {
      scope: options.scope,
      text: options.text,
      session_id: options.session_id,
      method: options.method ?? 'clipboard',
      include_snapshot: options.include_snapshot ?? false,
    });
  }

  async scroll(options: {
    scope: 'browser' | 'desktop';
    direction: 'up' | 'down';
    amount?: number;
    session_id?: string;
    include_snapshot?: boolean;  // DEPRECATED v10.2.0: snapshot always included for browser actions
  }): Promise<ToolServerResponse & { snapshot?: string; snapshot_url?: string; snapshot_title?: string; snapshot_ref_count?: number }> {
    return this.post('/scroll', {
      scope: options.scope,
      direction: options.direction,
      amount: options.amount ?? 500,
      session_id: options.session_id,
      include_snapshot: options.include_snapshot ?? false,
    });
  }

  async keypress(options: {
    scope: 'browser' | 'desktop';
    keys: string;
    session_id?: string;
    include_snapshot?: boolean;  // DEPRECATED v10.2.0: snapshot always included for browser actions
  }): Promise<ToolServerResponse & { snapshot?: string; snapshot_url?: string; snapshot_title?: string; snapshot_ref_count?: number }> {
    return this.post('/keypress', {
      scope: options.scope,
      keys: options.keys,
      session_id: options.session_id,
      include_snapshot: options.include_snapshot ?? false,
    });
  }
}

// Singleton instance
export const toolServerClient = new ToolServerClient();

// Export class for custom instances
export { ToolServerClient };
