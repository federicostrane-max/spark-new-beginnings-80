import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle, XCircle, Clock, AlertTriangle, Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface OperationLog {
  id: string;
  operation_type: string;
  agent_id: string;
  agent_name: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: 'running' | 'success' | 'failed' | 'timeout' | 'partial_success';
  error_message: string | null;
  error_code: string | null;
  input_data: any;
  output_data: any;
  metrics: any;
  validation_status: string | null;
  validation_details: any;
}

export const OperationsDashboard = () => {
  const [operations, setOperations] = useState<OperationLog[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [selectedOperation, setSelectedOperation] = useState<OperationLog | null>(null);

  useEffect(() => {
    fetchOperations();
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('operation_logs')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_operation_logs'
        },
        () => {
          fetchOperations();
        }
      )
      .subscribe();
    
    return () => {
      channel.unsubscribe();
    };
  }, [filter]);

  const fetchOperations = async () => {
    setLoading(true);
    
    let query = supabase
      .from('agent_operation_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50);
    
    if (filter !== 'all') {
      query = query.eq('status', filter);
    }
    
    const { data } = await query;
    setOperations((data as OperationLog[]) || []);
    setLoading(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'timeout':
        return <Clock className="w-4 h-4 text-orange-500" />;
      case 'partial_success':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      running: 'default',
      success: 'secondary',
      failed: 'destructive',
      timeout: 'destructive',
      partial_success: 'outline'
    };
    
    return (
      <Badge variant={variants[status] || 'default'} className="capitalize">
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const formatOperationType = (type: string) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Log Operazioni</CardTitle>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte</SelectItem>
                <SelectItem value="running">In Corso</SelectItem>
                <SelectItem value="success">Successo</SelectItem>
                <SelectItem value="failed">Fallite</SelectItem>
                <SelectItem value="timeout">Timeout</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : operations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nessuna operazione trovata
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stato</TableHead>
                    <TableHead>Operazione</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead>Avviato</TableHead>
                    <TableHead>Durata</TableHead>
                    <TableHead>Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(op.status)}
                          {getStatusBadge(op.status)}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatOperationType(op.operation_type)}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {op.agent_name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(op.started_at), { 
                          addSuffix: true,
                          locale: it 
                        })}
                      </TableCell>
                      <TableCell>
                        {op.duration_ms ? `${(op.duration_ms / 1000).toFixed(1)}s` : '-'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedOperation(op)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={!!selectedOperation} onOpenChange={(open) => !open && setSelectedOperation(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Dettagli Operazione</DialogTitle>
            <DialogDescription>
              {selectedOperation && formatOperationType(selectedOperation.operation_type)}
            </DialogDescription>
          </DialogHeader>
          
          {selectedOperation && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                {/* Status */}
                <div>
                  <h4 className="font-semibold mb-2">Stato</h4>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(selectedOperation.status)}
                    {getStatusBadge(selectedOperation.status)}
                  </div>
                </div>

                {/* Timing */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-semibold mb-2">Avviato</h4>
                    <p className="text-sm text-muted-foreground">
                      {new Date(selectedOperation.started_at).toLocaleString('it-IT')}
                    </p>
                  </div>
                  {selectedOperation.completed_at && (
                    <div>
                      <h4 className="font-semibold mb-2">Completato</h4>
                      <p className="text-sm text-muted-foreground">
                        {new Date(selectedOperation.completed_at).toLocaleString('it-IT')}
                      </p>
                    </div>
                  )}
                </div>

                {/* Duration */}
                {selectedOperation.duration_ms && (
                  <div>
                    <h4 className="font-semibold mb-2">Durata</h4>
                    <p className="text-sm">{(selectedOperation.duration_ms / 1000).toFixed(2)}s</p>
                  </div>
                )}

                {/* Error */}
                {selectedOperation.error_message && (
                  <div>
                    <h4 className="font-semibold mb-2 text-destructive">Errore</h4>
                    <div className="bg-destructive/10 p-3 rounded-lg">
                      <p className="text-sm font-mono">{selectedOperation.error_message}</p>
                      {selectedOperation.error_code && (
                        <Badge variant="outline" className="mt-2">
                          {selectedOperation.error_code}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* Metrics */}
                {selectedOperation.metrics && Object.keys(selectedOperation.metrics).length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Metriche</h4>
                    <div className="bg-muted p-3 rounded-lg">
                      <pre className="text-xs overflow-x-auto">
                        {JSON.stringify(selectedOperation.metrics, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Validation */}
                {selectedOperation.validation_status && (
                  <div>
                    <h4 className="font-semibold mb-2">Validazione</h4>
                    <Badge variant={
                      selectedOperation.validation_status === 'passed' ? 'secondary' :
                      selectedOperation.validation_status === 'failed' ? 'destructive' : 'outline'
                    }>
                      {selectedOperation.validation_status}
                    </Badge>
                    {selectedOperation.validation_details && (
                      <div className="bg-muted p-3 rounded-lg mt-2">
                        <pre className="text-xs overflow-x-auto">
                          {JSON.stringify(selectedOperation.validation_details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Input Data */}
                {selectedOperation.input_data && (
                  <div>
                    <h4 className="font-semibold mb-2">Input</h4>
                    <div className="bg-muted p-3 rounded-lg">
                      <pre className="text-xs overflow-x-auto">
                        {JSON.stringify(selectedOperation.input_data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Output Data */}
                {selectedOperation.output_data && (
                  <div>
                    <h4 className="font-semibold mb-2">Output</h4>
                    <div className="bg-muted p-3 rounded-lg">
                      <pre className="text-xs overflow-x-auto">
                        {JSON.stringify(selectedOperation.output_data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
