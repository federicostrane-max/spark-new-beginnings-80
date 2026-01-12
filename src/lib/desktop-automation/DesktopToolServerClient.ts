// ============================================================
// DESKTOP TOOL SERVER CLIENT
// Communicates with tool_server.py for desktop automation
// All coordinates use 'lux_sdk' origin (1260x700 space)
// ============================================================

import { DesktopToolServerResponse } from './types';

const DEFAULT_CONFIG = {
  baseUrl: 'http://127.0.0.1:8766',
  timeout: 30000
};

export class DesktopToolServerClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: Partial<typeof DEFAULT_CONFIG> = {}) {
    this.baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
    this.timeout = config.timeout || DEFAULT_CONFIG.timeout;
  }

  /**
   * Take a screenshot of the entire desktop.
   * Returns base64-encoded PNG image.
   */
  async screenshotDesktop(): Promise<{ success: boolean; screenshot?: string; error?: string }> {
    return this.sendAction({
      action: 'screenshot',
      scope: 'desktop'
    });
  }

  /**
   * Click at coordinates on desktop.
   * IMPORTANT: Always uses coordinate_origin: 'lux_sdk' for desktop.
   * Lux API returns coordinates in 1260x700 space, tool_server converts to screen.
   */
  async clickDesktop(
    x: number, 
    y: number, 
    clickType: 'single' | 'double' | 'right' = 'single'
  ): Promise<DesktopToolServerResponse> {
    console.log(`🖱️ [Desktop] Click at (${x}, ${y}) [lux_sdk] - type: ${clickType}`);
    
    return this.sendAction({
      action: 'click',
      scope: 'desktop',
      x,
      y,
      coordinate_origin: 'lux_sdk',  // CRITICAL: Always lux_sdk for desktop
      click_type: clickType
    });
  }

  /**
   * Type text on desktop.
   * Uses clipboard method for better compatibility with international keyboards.
   */
  async typeDesktop(text: string): Promise<DesktopToolServerResponse> {
    console.log(`⌨️ [Desktop] Typing: "${text.slice(0, 30)}${text.length > 30 ? '...' : ''}"`);
    
    return this.sendAction({
      action: 'type',
      scope: 'desktop',
      text
    });
  }

  /**
   * Press special keys on desktop.
   * Supported keys: Enter, Tab, Escape, Backspace, Delete, Up, Down, Left, Right, etc.
   */
  async keypressDesktop(keys: string): Promise<DesktopToolServerResponse> {
    console.log(`🔤 [Desktop] Keypress: ${keys}`);
    
    return this.sendAction({
      action: 'keypress',
      scope: 'desktop',
      keys
    });
  }

  /**
   * Scroll on desktop.
   */
  async scrollDesktop(
    direction: 'up' | 'down', 
    amount: number = 3
  ): Promise<DesktopToolServerResponse> {
    console.log(`📜 [Desktop] Scroll ${direction} by ${amount}`);
    
    return this.sendAction({
      action: 'scroll',
      scope: 'desktop',
      direction,
      amount
    });
  }

  /**
   * Move mouse to coordinates without clicking.
   */
  async moveDesktop(x: number, y: number): Promise<DesktopToolServerResponse> {
    console.log(`↗️ [Desktop] Move to (${x}, ${y}) [lux_sdk]`);
    
    return this.sendAction({
      action: 'move',
      scope: 'desktop',
      x,
      y,
      coordinate_origin: 'lux_sdk'
    });
  }

  /**
   * Check if tool_server.py is running and accessible.
   */
  async healthCheck(): Promise<{ online: boolean; version?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        return { online: true, version: data.version };
      }
      return { online: false };
    } catch {
      return { online: false };
    }
  }

  /**
   * Send action to tool_server.py
   */
  private async sendAction(payload: Record<string, unknown>): Promise<DesktopToolServerResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json();
      return data;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timeout' };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Singleton instance
export const desktopToolServerClient = new DesktopToolServerClient();
