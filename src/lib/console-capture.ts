/**
 * Console Capture System
 *
 * Cattura tutti i log della console e li salva in localStorage.
 * Claude può leggere questi log tramite una edge function o esportandoli.
 */

interface LogEntry {
  timestamp: string;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  data?: any;
}

const MAX_LOGS = 500; // Mantieni solo gli ultimi 500 log
const STORAGE_KEY = 'claude_console_logs';

let logs: LogEntry[] = [];
let isCapturing = false;

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

  originalConsole.log('[ConsoleCapture] Started capturing console logs');
}

export function stopConsoleCapture() {
  if (!isCapturing) return;
  isCapturing = false;

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
  localStorage.removeItem(STORAGE_KEY);
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

// Esponi globalmente per debug
if (typeof window !== 'undefined') {
  (window as any).__consoleLogs = {
    getLogs,
    getLogsAsText,
    clearLogs,
    exportLogsToFile,
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
