import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Loader2, 
  RefreshCw,
  Clock,
  TrendingUp
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  MaintenanceExecutionLog,
  MaintenanceOperationDetail,
  getExecutionStatusBadge,
  formatExecutionSummary,
  fetchMaintenanceLogs,
  getOperationDetails,
  getPersistentProblems,
  getMaintenanceStats,
  triggerManualMaintenance
} from "@/lib/maintenanceHelpers";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";

export const MaintenanceMonitor = () => {
  const [executions, setExecutions] = useState<MaintenanceExecutionLog[]>([]);
  const [stats, setStats] = useState({
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalDocumentsFixed: 0,
    totalChunksCleaned: 0,
    totalAgentsSynced: 0
  });
  const [persistentProblems, setPersistentProblems] = useState<MaintenanceOperationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<MaintenanceExecutionLog | null>(null);
  const [operationDetails, setOperationDetails] = useState<MaintenanceOperationDetail[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    loadData();
    
    // Real-time subscription
    const channel = supabase
      .channel('maintenance-logs')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'maintenance_execution_logs'
      }, (payload) => {
        console.log('[MaintenanceMonitor] Real-time update:', payload);
        loadData();
        
        if (payload.eventType === 'UPDATE' && payload.new) {
          const newLog = payload.new as MaintenanceExecutionLog;
          if (newLog.execution_status === 'success') {
            const summary = formatExecutionSummary(newLog);
            if (summary !== 'Nessuna operazione') {
              toast.success(`✅ Manutenzione completata: ${summary}`);
            }
          } else if (newLog.execution_status === 'partial_failure') {
            toast.warning('⚠️ Manutenzione completata con alcuni errori');
          }
        }
      })
      .subscribe();
    
    return () => {
      channel.unsubscribe();
    };
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [logsData, statsData, problemsData] = await Promise.all([
        fetchMaintenanceLogs(50),
        getMaintenanceStats(),
        getPersistentProblems()
      ]);
      
      setExecutions(logsData);
      setStats(statsData);
      setPersistentProblems(problemsData);
    } catch (error) {
      console.error('[MaintenanceMonitor] Error loading data:', error);
      toast.error('Errore nel caricamento dei log di manutenzione');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerMaintenance = async () => {
    setTriggering(true);
    try {
      const result = await triggerManualMaintenance();
      if (result.success) {
        toast.success('Manutenzione avviata con successo');
        setTimeout(() => loadData(), 2000);
      } else {
        toast.error(`Errore: ${result.error}`);
      }
    } catch (error) {
      toast.error('Errore nell\'avvio della manutenzione');
    } finally {
      setTriggering(false);
    }
  };

  const handleViewDetails = async (execution: MaintenanceExecutionLog) => {
    setSelectedExecution(execution);
    setDetailsLoading(true);
    try {
      const details = await getOperationDetails(execution.id);
      setOperationDetails(details);
    } catch (error) {
      toast.error('Errore nel caricamento dei dettagli');
    } finally {
      setDetailsLoading(false);
    }
  };

  const getOperationTypeLabel = (type: string) => {
    const labels = {
      fix_stuck_document: '📄 Fix Documento',
      cleanup_orphaned_chunk: '🧹 Cleanup Chunk',
      sync_agent: '🔄 Sync Agente'
    };
    return labels[type as keyof typeof labels] || type;
  };

  const getOperationStatusBadge = (status: string) => {
    const variants = {
      success: { variant: 'default' as const, label: 'Successo', className: 'bg-green-500' },
      failed: { variant: 'destructive' as const, label: 'Fallito', className: '' },
      retry_needed: { variant: 'secondary' as const, label: 'Retry', className: 'bg-yellow-500' }
    };
    return variants[status as keyof typeof variants] || variants.retry_needed;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="dashboard" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="executions">Log Esecuzioni</TabsTrigger>
        <TabsTrigger value="problems">Problemi Persistenti</TabsTrigger>
        <TabsTrigger value="config">Configurazione</TabsTrigger>
      </TabsList>

      {/* TAB 1: Dashboard Statistiche */}
      <TabsContent value="dashboard">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Statistiche Ultime 24h
            </CardTitle>
            <CardDescription>Panoramica dell'attività di auto-manutenzione</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="flex flex-col items-center p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Clock className="h-8 w-8 text-blue-500 mb-2" />
                <div className="text-2xl font-bold text-blue-500">{stats.totalExecutions}</div>
                <div className="text-sm text-muted-foreground text-center">Esecuzioni Totali</div>
              </div>

              <div className="flex flex-col items-center p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                <div className="text-2xl font-bold text-green-500">{stats.successfulExecutions}</div>
                <div className="text-sm text-muted-foreground text-center">Successi</div>
              </div>

              <div className="flex flex-col items-center p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <XCircle className="h-8 w-8 text-red-500 mb-2" />
                <div className="text-2xl font-bold text-red-500">{stats.failedExecutions}</div>
                <div className="text-sm text-muted-foreground text-center">Con Errori</div>
              </div>

              <div className="flex flex-col items-center p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <div className="text-3xl mb-2">📄</div>
                <div className="text-2xl font-bold text-purple-500">{stats.totalDocumentsFixed}</div>
                <div className="text-sm text-muted-foreground text-center">Documenti Riparati</div>
              </div>

              <div className="flex flex-col items-center p-4 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <div className="text-3xl mb-2">🧹</div>
                <div className="text-2xl font-bold text-orange-500">{stats.totalChunksCleaned}</div>
                <div className="text-sm text-muted-foreground text-center">Chunk Eliminati</div>
              </div>

              <div className="flex flex-col items-center p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <div className="text-3xl mb-2">🔄</div>
                <div className="text-2xl font-bold text-cyan-500">{stats.totalAgentsSynced}</div>
                <div className="text-sm text-muted-foreground text-center">Agenti Sincronizzati</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* TAB 2: Log Esecuzioni */}
      <TabsContent value="executions">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Log Esecuzioni</CardTitle>
                <CardDescription>Cronologia delle ultime 50 esecuzioni automatiche</CardDescription>
              </div>
              <Button onClick={loadData} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Aggiorna
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-3">
                {executions.length === 0 ? (
                  <Alert>
                    <AlertDescription>
                      Nessuna esecuzione registrata. Il timer non è ancora partito.
                    </AlertDescription>
                  </Alert>
                ) : (
                  executions.map((execution) => {
                    const badge = getExecutionStatusBadge(execution.execution_status);
                    const Icon = badge.icon;
                    
                    return (
                      <Card key={execution.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                        <CardContent className="p-4" onClick={() => handleViewDetails(execution)}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <Icon className={`h-5 w-5 mt-1 flex-shrink-0 ${badge.className}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge className={badge.color}>{badge.text}</Badge>
                                  <span className="text-sm text-muted-foreground">
                                    {formatDistanceToNow(new Date(execution.execution_started_at), { 
                                      addSuffix: true, 
                                      locale: it 
                                    })}
                                  </span>
                                </div>
                                <p className="text-sm font-medium">
                                  {formatExecutionSummary(execution)}
                                </p>
                                {execution.error_message && (
                                  <p className="text-sm text-red-500 mt-1">
                                    ⚠️ {execution.error_message}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>

      {/* TAB 3: Problemi Persistenti */}
      <TabsContent value="problems">
        <Card>
          <CardHeader>
            <CardTitle>Problemi Persistenti</CardTitle>
            <CardDescription>Operazioni fallite dopo 3 tentativi di retry</CardDescription>
          </CardHeader>
          <CardContent>
            {persistentProblems.length === 0 ? (
              <Alert className="border-green-500/50 bg-green-500/10">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <AlertTitle className="text-green-500">✅ Nessun Problema Persistente</AlertTitle>
                <AlertDescription>
                  Tutti i problemi sono stati risolti automaticamente o non ci sono errori!
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                {persistentProblems.map((problem) => (
                  <Card key={problem.id} className="border-red-500/30">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <XCircle className="h-5 w-5 text-red-500 mt-1 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{problem.target_name}</span>
                            <Badge variant="outline">{getOperationTypeLabel(problem.operation_type)}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            Fallito dopo {problem.attempt_number} tentativi
                          </p>
                          {problem.error_message && (
                            <p className="text-sm text-red-500">
                              Errore: {problem.error_message}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* TAB 4: Configurazione */}
      <TabsContent value="config">
        <Card>
          <CardHeader>
            <CardTitle>Configurazione Sistema</CardTitle>
            <CardDescription>Parametri e controlli manuali</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border">
                <div className="text-sm text-muted-foreground">Frequenza Timer</div>
                <div className="text-2xl font-bold">5 minuti</div>
              </div>
              <div className="p-4 rounded-lg border">
                <div className="text-sm text-muted-foreground">Max Retry</div>
                <div className="text-2xl font-bold">3 tentativi</div>
              </div>
              <div className="p-4 rounded-lg border">
                <div className="text-sm text-muted-foreground">Retention Log</div>
                <div className="text-2xl font-bold">7 giorni</div>
              </div>
              <div className="p-4 rounded-lg border">
                <div className="text-sm text-muted-foreground">Timeout Stuck</div>
                <div className="text-2xl font-bold">10 minuti</div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">Trigger Manuale</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Avvia manualmente un ciclo di manutenzione per testare il sistema
              </p>
              <Button 
                onClick={handleTriggerMaintenance} 
                disabled={triggering}
                className="w-full"
              >
                {triggering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Esecuzione in corso...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Avvia Manutenzione Manuale
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Dialog per Dettagli Esecuzione */}
      <Dialog open={!!selectedExecution} onOpenChange={() => setSelectedExecution(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Dettagli Esecuzione</DialogTitle>
            <DialogDescription>
              {selectedExecution && (
                <span>
                  Avviata {formatDistanceToNow(new Date(selectedExecution.execution_started_at), { 
                    addSuffix: true, 
                    locale: it 
                  })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {detailsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-3">
                {operationDetails.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessuna operazione eseguita</p>
                ) : (
                  operationDetails.map((detail) => {
                    const statusBadge = getOperationStatusBadge(detail.status);
                    return (
                      <Card key={detail.id}>
                        <CardContent className="p-3">
                          <div className="flex items-start gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant={statusBadge.variant} className={statusBadge.className}>
                                  {statusBadge.label}
                                </Badge>
                                <span className="text-sm font-medium">{detail.target_name}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{getOperationTypeLabel(detail.operation_type)}</span>
                                <span>•</span>
                                <span>Tentativo {detail.attempt_number}</span>
                              </div>
                              {detail.error_message && (
                                <p className="text-xs text-red-500 mt-1">
                                  {detail.error_message}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
};
