/**
 * Console Capture System
 *
 * Cattura tutti i log della console e li salva in localStorage e Supabase.
 * Claude può leggere questi log dalla tabella debug_logs in Supabase.
 */

import { supabase } from "@/integrations/supabase/client";

interface LogEntry {
  timestamp: string;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  data?: any;
}

const MAX_LOGS = 500; // Mantieni solo gli ultimi 500 log
const STORAGE_KEY = 'claude_console_logs';
const SYNC_INTERVAL = 3000; // Sync to Supabase every 3 seconds

let logs: LogEntry[] = [];
let isCapturing = false;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let lastSyncedLength = 0;

// Salva i log originali
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};

function formatData(args: any[]): string {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

function captureLog(level: LogEntry['level'], args: any[]) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: formatData(args),
  };

  logs.push(entry);

  // Mantieni solo gli ultimi MAX_LOGS
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(-MAX_LOGS);
  }

  // Salva in localStorage
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    // localStorage pieno, riduci i log
    logs = logs.slice(-100);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch {
      // Ignora
    }
  }
}

// Sync logs to Supabase for Claude to read
async function syncToSupabase() {
  // Only sync if there are new logs
  if (logs.length === lastSyncedLength) return;

  try {
    // Use 'as any' cast because debug_logs table types haven't been regenerated yet
    const { error } = await (supabase as any)
      .from('debug_logs')
      .upsert({
        id: 'default',
        logs: logs,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id'
      });

    if (error) {
      // Table might not exist yet, silently ignore
      if (!error.message.includes('does not exist')) {
        originalConsole.warn('[ConsoleCapture] Supabase sync error:', error.message);
      }
    } else {
      lastSyncedLength = logs.length;
    }
  } catch (e) {
    // Silently fail - don't want to spam console
  }
}

export function startConsoleCapture() {
  if (isCapturing) return;
  isCapturing = true;

  // Carica log esistenti
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      logs = JSON.parse(saved);
    }
  } catch {
    logs = [];
  }

  // Override console methods
  console.log = (...args: any[]) => {
    captureLog('log', args);
    originalConsole.log.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    captureLog('warn', args);
    originalConsole.warn.apply(console, args);
  };

  console.error = (...args: any[]) => {
    captureLog('error', args);
    originalConsole.error.apply(console, args);
  };

  console.info = (...args: any[]) => {
    captureLog('info', args);
    originalConsole.info.apply(console, args);
  };

  console.debug = (...args: any[]) => {
    captureLog('debug', args);
    originalConsole.debug.apply(console, args);
  };

  // Start periodic sync to Supabase
  syncIntervalId = setInterval(syncToSupabase, SYNC_INTERVAL);

  // Also sync on page unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', syncToSupabase);
  }

  // Initial sync
  setTimeout(syncToSupabase, 1000);

  originalConsole.log('[ConsoleCapture] Started capturing console logs (syncing to Supabase)');
}

export function stopConsoleCapture() {
  if (!isCapturing) return;
  isCapturing = false;

  // Stop sync interval
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }

  // Final sync
  syncToSupabase();

  // Ripristina console originale
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;

  originalConsole.log('[ConsoleCapture] Stopped capturing');
}

export function getLogs(): LogEntry[] {
  return [...logs];
}

export function getLogsAsText(): string {
  return logs.map(entry =>
    `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`
  ).join('\n');
}

export function clearLogs() {
  logs = [];
  lastSyncedLength = 0;
  localStorage.removeItem(STORAGE_KEY);
  // Also clear from Supabase
  (supabase as any).from('debug_logs').delete().eq('id', 'default').then(() => {});
}

export function exportLogsToFile() {
  const text = getLogsAsText();
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `console-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// Force immediate sync (useful for debugging)
export async function forceSyncNow() {
  lastSyncedLength = 0; // Force sync even if no new logs
  await syncToSupabase();
  return logs.length;
}

// Esponi globalmente per debug
if (typeof window !== 'undefined') {
  (window as any).__consoleLogs = {
    getLogs,
    getLogsAsText,
    clearLogs,
    exportLogsToFile,
    forceSyncNow,
    // Esporta in un file nella cartella del progetto (per Claude)
    saveToProject: async () => {
      const text = getLogsAsText();
      // Salva in localStorage con chiave speciale che Claude può leggere
      localStorage.setItem('claude_debug_logs', text);
      originalConsole.log('[ConsoleCapture] Logs saved to localStorage key: claude_debug_logs');
      return text;
    }
  };
}
