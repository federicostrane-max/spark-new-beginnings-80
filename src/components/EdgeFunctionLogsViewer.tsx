import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, AlertCircle, Info, AlertTriangle, XCircle } from 'lucide-react';
import { format } from 'date-fns';

interface EdgeLog {
  id: string;
  function_name: string;
  execution_id: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata: Record<string, any>;
  agent_id: string | null;
  created_at: string;
}

interface EdgeFunctionLogsViewerProps {
  agentId?: string;
  functionName?: string;
  executionId?: string;
  limit?: number;
  enableRealtime?: boolean;
}

export const EdgeFunctionLogsViewer = ({
  agentId,
  functionName,
  executionId,
  limit = 100,
  enableRealtime = true
}: EdgeFunctionLogsViewerProps) => {
  const [logs, setLogs] = useState<EdgeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();

    if (enableRealtime) {
      const channel = supabase
        .channel('edge-logs-realtime')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'edge_function_execution_logs',
            filter: agentId ? `agent_id=eq.${agentId}` : undefined
          },
          (payload) => {
            setLogs(prev => [payload.new as EdgeLog, ...prev].slice(0, limit));
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [agentId, functionName, executionId, limit, enableRealtime]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('edge_function_execution_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (agentId) query = query.eq('agent_id', agentId);
      if (functionName) query = query.eq('function_name', functionName);
      if (executionId) query = query.eq('execution_id', executionId);

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setLogs((data || []) as EdgeLog[]);
    } catch (err) {
      console.error('Failed to fetch edge function logs:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'warn':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case 'info':
        return <Info className="h-4 w-4 text-info" />;
      case 'debug':
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getLevelBadge = (level: string) => {
    const variants: Record<string, 'destructive' | 'secondary' | 'outline' | 'default'> = {
      error: 'destructive',
      warn: 'secondary',
      info: 'default',
      debug: 'outline'
    };
    return <Badge variant={variants[level] || 'default'}>{level.toUpperCase()}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="h-5 w-5" />
            Error Loading Logs
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (logs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-8 text-muted-foreground">
          <Info className="h-12 w-12 mb-4 opacity-50" />
          <p>No logs found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edge Function Execution Logs</CardTitle>
        <CardDescription>
          Real-time logs from Supabase Edge Functions ({logs.length} entries)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="border rounded-lg p-4 hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {getLevelIcon(log.log_level)}
                    <span className="font-mono text-sm font-medium truncate">
                      {log.function_name}
                    </span>
                    {getLevelBadge(log.log_level)}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(log.created_at), 'HH:mm:ss.SSS')}
                  </span>
                </div>
                
                <p className="text-sm mb-2">{log.message}</p>
                
                {Object.keys(log.metadata).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      View metadata
                    </summary>
                    <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </details>
                )}
                
                <div className="flex gap-2 mt-2 text-xs text-muted-foreground font-mono">
                  <span>Exec: {log.execution_id.slice(0, 8)}</span>
                  {log.agent_id && (
                    <span>Agent: {log.agent_id.slice(0, 8)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
