import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMetadata {
  [key: string]: any;
}

export class EdgeFunctionLogger {
  private supabase: SupabaseClient;
  private functionName: string;
  public readonly executionId: string; // Public for logging
  private agentId?: string;

  constructor(
    supabase: SupabaseClient,
    functionName: string,
    executionId: string,
    agentId?: string
  ) {
    this.supabase = supabase;
    this.functionName = functionName;
    this.executionId = executionId;
    this.agentId = agentId;
  }

  private async writeLog(
    level: LogLevel,
    message: string,
    metadata?: LogMetadata
  ): Promise<void> {
    // Console log for immediate debug
    const timestamp = new Date().toISOString();
    const prefix = `[${this.functionName}][${this.executionId}]`;
    
    switch (level) {
      case 'error':
        console.error(`${prefix} ❌`, message, metadata || '');
        break;
      case 'warn':
        console.warn(`${prefix} ⚠️`, message, metadata || '');
        break;
      case 'info':
        console.info(`${prefix} ℹ️`, message, metadata || '');
        break;
      case 'debug':
        console.log(`${prefix} 🔍`, message, metadata || '');
        break;
    }

    // Write to database for persistence
    try {
      const { error } = await this.supabase
        .from('edge_function_execution_logs')
        .insert({
          function_name: this.functionName,
          execution_id: this.executionId,
          log_level: level,
          message,
          metadata: metadata || {},
          agent_id: this.agentId || null,
        });

      if (error) {
        console.error('Failed to write log to database:', error);
      }
    } catch (err) {
      console.error('Exception writing log to database:', err);
    }
  }

  async debug(message: string, metadata?: LogMetadata): Promise<void> {
    await this.writeLog('debug', message, metadata);
  }

  async info(message: string, metadata?: LogMetadata): Promise<void> {
    await this.writeLog('info', message, metadata);
  }

  async warn(message: string, metadata?: LogMetadata): Promise<void> {
    await this.writeLog('warn', message, metadata);
  }

  async error(message: string, metadata?: LogMetadata): Promise<void> {
    await this.writeLog('error', message, metadata);
  }
}

// Helper function to create logger instance
export function createLogger(
  functionName: string,
  agentId?: string
): EdgeFunctionLogger {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  const executionId = crypto.randomUUID();
  
  return new EdgeFunctionLogger(supabase, functionName, executionId, agentId);
}
