// ============================================================
// Session Manager - Gestisce browser session_id
// ============================================================

import { toolServerClient } from './client';

class SessionManager {
  private currentSessionId: string | null = null;
  private listeners: Set<(sessionId: string | null) => void> = new Set();

  // ──────────────────────────────────────────────────────────
  // Getters
  // ──────────────────────────────────────────────────────────

  get sessionId(): string | null {
    return this.currentSessionId;
  }

  get hasActiveSession(): boolean {
    return this.currentSessionId !== null;
  }

  // ──────────────────────────────────────────────────────────
  // Session Lifecycle
  // ──────────────────────────────────────────────────────────

  async startSession(url: string): Promise<string> {
    // Se c'è già una sessione, chiudila prima
    if (this.currentSessionId) {
      await this.endSession();
    }

    const result = await toolServerClient.browserStart(url);
    
    if (!result.success || !result.session_id) {
      throw new Error('Failed to start browser session');
    }

    this.currentSessionId = result.session_id;
    this.notifyListeners();

    console.log(`🌐 Browser session started: ${this.currentSessionId}`);
    return this.currentSessionId;
  }

  async endSession(): Promise<void> {
    if (!this.currentSessionId) return;

    try {
      await toolServerClient.browserStop(this.currentSessionId);
      console.log(`🔴 Browser session ended: ${this.currentSessionId}`);
    } catch (error) {
      console.warn('Error stopping session:', error);
    }

    this.currentSessionId = null;
    this.notifyListeners();
  }

  // ──────────────────────────────────────────────────────────
  // From Tool Result (auto-capture session_id)
  // ──────────────────────────────────────────────────────────

  captureFromToolResult(result: Record<string, unknown>): void {
    if (result.session_id && typeof result.session_id === 'string') {
      this.currentSessionId = result.session_id;
      this.notifyListeners();
      console.log(`📌 Session captured: ${this.currentSessionId}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Listeners (for React state sync)
  // ──────────────────────────────────────────────────────────

  subscribe(listener: (sessionId: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.currentSessionId));
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
