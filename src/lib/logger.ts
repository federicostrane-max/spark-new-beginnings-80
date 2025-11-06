/**
 * Sistema di logging centralizzato per tracciare problemi e operazioni nell'app
 */

export type LogLevel = 'info' | 'warning' | 'error' | 'success';
export type LogCategory = 
  | 'document-sync' 
  | 'agent-operation' 
  | 'knowledge-base' 
  | 'pool-documents'
  | 'file-upload'
  | 'database'
  | 'auth';

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: any;
  agentId?: string;
  documentId?: string;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 500; // Mantieni solo gli ultimi 500 log

  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    details?: any,
    metadata?: { agentId?: string; documentId?: string }
  ) {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category,
      message,
      details,
      ...metadata
    };

    this.logs.push(entry);

    // Mantieni solo gli ultimi maxLogs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Log anche in console per development
    const emoji = this.getEmoji(level);
    const categoryTag = `[${category}]`;
    const metadataStr = metadata ? ` (${JSON.stringify(metadata)})` : '';
    
    console.log(`${emoji} ${categoryTag} ${message}${metadataStr}`, details || '');

    // Salva in localStorage per persistenza
    this.persistLogs();
  }

  private getEmoji(level: LogLevel): string {
    const emojis = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
      success: '✅'
    };
    return emojis[level];
  }

  info(category: LogCategory, message: string, details?: any, metadata?: { agentId?: string; documentId?: string }) {
    this.log('info', category, message, details, metadata);
  }

  warning(category: LogCategory, message: string, details?: any, metadata?: { agentId?: string; documentId?: string }) {
    this.log('warning', category, message, details, metadata);
  }

  error(category: LogCategory, message: string, details?: any, metadata?: { agentId?: string; documentId?: string }) {
    this.log('error', category, message, details, metadata);
  }

  success(category: LogCategory, message: string, details?: any, metadata?: { agentId?: string; documentId?: string }) {
    this.log('success', category, message, details, metadata);
  }

  // Ottieni log filtrati
  getLogs(filters?: {
    level?: LogLevel;
    category?: LogCategory;
    agentId?: string;
    since?: Date;
  }): LogEntry[] {
    let filtered = [...this.logs];

    if (filters?.level) {
      filtered = filtered.filter(log => log.level === filters.level);
    }

    if (filters?.category) {
      filtered = filtered.filter(log => log.category === filters.category);
    }

    if (filters?.agentId) {
      filtered = filtered.filter(log => log.agentId === filters.agentId);
    }

    if (filters?.since) {
      filtered = filtered.filter(log => log.timestamp >= filters.since);
    }

    return filtered;
  }

  // Ottieni errori recenti per agente
  getAgentErrors(agentId: string, sinceMinutes: number = 30): LogEntry[] {
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
    return this.getLogs({
      level: 'error',
      agentId,
      since
    });
  }

  // Ottieni warning recenti per agente
  getAgentWarnings(agentId: string, sinceMinutes: number = 30): LogEntry[] {
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
    return this.getLogs({
      level: 'warning',
      agentId,
      since
    });
  }

  // Conta problemi per agente
  getAgentIssueCount(agentId: string, sinceMinutes: number = 30): { errors: number; warnings: number } {
    return {
      errors: this.getAgentErrors(agentId, sinceMinutes).length,
      warnings: this.getAgentWarnings(agentId, sinceMinutes).length
    };
  }

  // Persisti in localStorage
  private persistLogs() {
    try {
      localStorage.setItem('app-logs', JSON.stringify(this.logs.slice(-100))); // Salva solo ultimi 100
    } catch (e) {
      console.error('Failed to persist logs', e);
    }
  }

  // Carica da localStorage
  loadPersistedLogs() {
    try {
      const stored = localStorage.getItem('app-logs');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.logs = parsed.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        }));
      }
    } catch (e) {
      console.error('Failed to load persisted logs', e);
    }
  }

  // Pulisci log vecchi
  clearOldLogs(olderThanHours: number = 24) {
    const threshold = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    this.logs = this.logs.filter(log => log.timestamp >= threshold);
    this.persistLogs();
  }

  // Pulisci log per agente specifico
  clearAgentLogs(agentId: string) {
    this.logs = this.logs.filter(log => log.agentId !== agentId);
    this.persistLogs();
  }

  // Pulisci tutti i log
  clearAllLogs() {
    this.logs = [];
    this.persistLogs();
  }

  // Esporta log come JSON per debugging
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Singleton instance
export const logger = new Logger();

// Carica log persistiti all'avvio
logger.loadPersistedLogs();
