/**
 * Sistema di logging centralizzato per operazioni sui documenti
 */

export type DocumentLogLevel = 'info' | 'warning' | 'error' | 'success';
export type DocumentLogCategory = 
  | 'validation' 
  | 'processing' 
  | 'sync'
  | 'cleanup'
  | 'assignment';

interface DocumentLogEntry {
  timestamp: Date;
  level: DocumentLogLevel;
  category: DocumentLogCategory;
  message: string;
  details?: any;
  documentId?: string;
  agentId?: string;
}

class DocumentLogger {
  private logs: DocumentLogEntry[] = [];
  private maxLogs = 1000; // Mantieni ultimi 1000 log

  log(
    level: DocumentLogLevel,
    category: DocumentLogCategory,
    message: string,
    details?: any,
    metadata?: { documentId?: string; agentId?: string }
  ) {
    const entry: DocumentLogEntry = {
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

    // Log in console per development
    const emoji = this.getEmoji(level);
    const categoryTag = `[${category}]`;
    const metadataStr = metadata ? ` (${JSON.stringify(metadata)})` : '';
    
    console.log(`${emoji} ${categoryTag} ${message}${metadataStr}`, details || '');

    // Salva in localStorage
    this.persistLogs();
  }

  private getEmoji(level: DocumentLogLevel): string {
    const emojis = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
      success: '✅'
    };
    return emojis[level];
  }

  // Metodi di convenienza per ogni categoria
  logValidationError(message: string, documentId: string, details?: any) {
    this.log('error', 'validation', message, details, { documentId });
  }

  logValidationSuccess(message: string, documentId: string, details?: any) {
    this.log('success', 'validation', message, details, { documentId });
  }

  logProcessingError(message: string, documentId: string, details?: any) {
    this.log('error', 'processing', message, details, { documentId });
  }

  logProcessingSuccess(message: string, documentId: string, details?: any) {
    this.log('success', 'processing', message, details, { documentId });
  }

  logSyncError(message: string, documentId: string, agentId: string, details?: any) {
    this.log('error', 'sync', message, details, { documentId, agentId });
  }

  logSyncSuccess(message: string, documentId: string, agentId: string, details?: any) {
    this.log('success', 'sync', message, details, { documentId, agentId });
  }

  logCleanupOperation(message: string, details?: any) {
    this.log('info', 'cleanup', message, details);
  }

  logAssignmentOperation(message: string, documentId: string, agentId: string, details?: any) {
    this.log('info', 'assignment', message, details, { documentId, agentId });
  }

  // Ottieni log filtrati
  getLogs(filters?: {
    level?: DocumentLogLevel;
    category?: DocumentLogCategory;
    documentId?: string;
    agentId?: string;
    since?: Date;
  }): DocumentLogEntry[] {
    let filtered = [...this.logs];

    if (filters?.level) {
      filtered = filtered.filter(log => log.level === filters.level);
    }

    if (filters?.category) {
      filtered = filtered.filter(log => log.category === filters.category);
    }

    if (filters?.documentId) {
      filtered = filtered.filter(log => log.documentId === filters.documentId);
    }

    if (filters?.agentId) {
      filtered = filtered.filter(log => log.agentId === filters.agentId);
    }

    if (filters?.since) {
      filtered = filtered.filter(log => log.timestamp >= filters.since);
    }

    return filtered;
  }

  // Ottieni errori recenti per documento
  getDocumentErrors(documentId: string, sinceMinutes: number = 30): DocumentLogEntry[] {
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
    return this.getLogs({
      level: 'error',
      documentId,
      since
    });
  }

  // Conta problemi per documento
  getDocumentIssueCount(documentId: string, sinceMinutes: number = 30): { errors: number; warnings: number } {
    const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
    return {
      errors: this.getLogs({ level: 'error', documentId, since }).length,
      warnings: this.getLogs({ level: 'warning', documentId, since }).length
    };
  }

  // Persisti in localStorage
  private persistLogs() {
    try {
      localStorage.setItem('document-logs', JSON.stringify(this.logs.slice(-200))); // Salva ultimi 200
    } catch (e) {
      console.error('Failed to persist document logs', e);
    }
  }

  // Carica da localStorage
  loadPersistedLogs() {
    try {
      const stored = localStorage.getItem('document-logs');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.logs = parsed.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        }));
      }
    } catch (e) {
      console.error('Failed to load persisted document logs', e);
    }
  }

  // Pulisci log vecchi
  clearOldLogs(olderThanHours: number = 24) {
    const threshold = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    this.logs = this.logs.filter(log => log.timestamp >= threshold);
    this.persistLogs();
  }

  // Esporta log come JSON per debugging
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  // Pulisci tutti i log
  clearAll() {
    this.logs = [];
    localStorage.removeItem('document-logs');
  }
}

// Singleton instance
export const documentLogger = new DocumentLogger();

// Carica log persistiti all'avvio
documentLogger.loadPersistedLogs();
