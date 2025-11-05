import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, Clock } from "lucide-react";

interface ProcessingLog {
  id: string;
  document_id: string;
  document_name: string;
  status: string;
  message: string;
  timestamp: string;
}

interface DocumentStatus {
  document_id: string;
  file_name: string;
  processing_status: string;
  error_message: string | null;
  processed_chunks: number;
  total_chunks: number | null;
  updated_at: string;
}

export const ProcessingLogs = () => {
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [activeDocuments, setActiveDocuments] = useState<DocumentStatus[]>([]);

  useEffect(() => {
    // Fetch initial active documents
    fetchActiveDocuments();

    // Subscribe to document_processing_cache updates
    const channel = supabase
      .channel('processing-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'document_processing_cache'
        },
        async (payload) => {
          console.log('Processing update received:', payload);
          
          // Add log entry
          const docId = (payload.new as any)?.document_id || (payload.old as any)?.document_id;
          const newLog: ProcessingLog = {
            id: crypto.randomUUID(),
            document_id: docId,
            document_name: 'Document',
            status: payload.eventType,
            message: getLogMessage(payload),
            timestamp: new Date().toISOString()
          };
          
          setLogs(prev => [newLog, ...prev].slice(0, 50)); // Keep last 50 logs
          
          // Refresh active documents
          fetchActiveDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchActiveDocuments = async () => {
    const { data: cacheData } = await supabase
      .from('document_processing_cache')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(10);

    if (cacheData) {
      // Fetch document names
      const docIds = cacheData.map(d => d.document_id);
      const { data: docs } = await supabase
        .from('knowledge_documents')
        .select('id, file_name')
        .in('id', docIds);

      const docsMap = new Map(docs?.map(d => [d.id, d.file_name]) || []);

      const documents: DocumentStatus[] = cacheData.map(cache => ({
        document_id: cache.document_id,
        file_name: docsMap.get(cache.document_id) || 'Unknown',
        processing_status: getStatusFromCache(cache),
        error_message: cache.error_message,
        processed_chunks: cache.processed_chunks || 0,
        total_chunks: cache.total_chunks,
        updated_at: cache.updated_at
      }));

      setActiveDocuments(documents);
    }
  };

  const getStatusFromCache = (cache: any): string => {
    if (cache.processing_completed_at) return 'completed';
    if (cache.error_message) return 'error';
    if (cache.processing_started_at) return 'processing';
    return 'pending';
  };

  const getLogMessage = (payload: any): string => {
    const event = payload.eventType;
    const data = payload.new || payload.old;
    
    if (event === 'INSERT') return 'Elaborazione iniziata';
    if (event === 'UPDATE') {
      if (data.processing_completed_at) return 'Elaborazione completata';
      if (data.error_message) return `Errore: ${data.error_message}`;
      return `Progresso: ${data.processed_chunks || 0}/${data.total_chunks || '?'} chunks`;
    }
    if (event === 'DELETE') return 'Record rimosso';
    return event;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      completed: "default",
      error: "destructive",
      processing: "secondary",
      pending: "outline"
    };

    return (
      <Badge variant={variants[status] || "outline"}>
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Active Documents Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Documenti in Elaborazione
          </CardTitle>
          <CardDescription>
            Stato corrente dei documenti in elaborazione
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun documento in elaborazione
            </p>
          ) : (
            <div className="space-y-2">
              {activeDocuments.map((doc) => (
                <div
                  key={doc.document_id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {getStatusIcon(doc.processing_status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {doc.file_name}
                      </p>
                      {doc.error_message && (
                        <p className="text-xs text-destructive truncate">
                          {doc.error_message}
                        </p>
                      )}
                      {doc.processing_status === 'processing' && doc.total_chunks && (
                        <p className="text-xs text-muted-foreground">
                          {doc.processed_chunks} / {doc.total_chunks} chunks
                        </p>
                      )}
                    </div>
                  </div>
                  {getStatusBadge(doc.processing_status)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Real-time Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Log Real-time</CardTitle>
          <CardDescription>
            Monitoraggio in tempo reale dell'elaborazione
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px] w-full">
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                In attesa di eventi...
              </p>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 p-2 border-l-2 border-primary/20 pl-3"
                  >
                    <Badge variant="outline" className="text-xs">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {log.status}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {log.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
