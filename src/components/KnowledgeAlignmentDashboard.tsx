import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, XCircle, AlertCircle, RotateCcw, Play, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { useKnowledgeAlignment } from '@/hooks/useKnowledgeAlignment';
import { KNOWLEDGE_ALIGNMENT_CONFIG } from '@/config/knowledgeAlignmentConfig';

interface KnowledgeAlignmentDashboardProps {
  agentId: string;
}

interface AnalysisLog {
  id: string;
  started_at: string;
  total_chunks_analyzed: number;
  chunks_flagged_for_removal: number;
  chunks_auto_removed: number;
  concept_coverage_percentage: number;
  safe_mode_active: boolean;
  trigger_type: string;
}

interface RemovedChunk {
  id: string;
  chunk_id: string;
  document_name: string;
  content: string;
  removal_reason: string;
  removed_at: string;
  final_relevance_score: number;
  restored_at: string | null;
}

export const KnowledgeAlignmentDashboard = ({ agentId }: KnowledgeAlignmentDashboardProps) => {
  const [analysisLogs, setAnalysisLogs] = useState<AnalysisLog[]>([]);
  const [removedChunks, setRemovedChunks] = useState<RemovedChunk[]>([]);
  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(new Set());
  const [isRestoring, setIsRestoring] = useState(false);
  const [safeModeActive, setSafeModeActive] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [stats, setStats] = useState({
    totalChunks: 0,
    removedChunks: 0,
    conceptCoverage: 0,
  });

  const { isAnalyzing, lastAnalysis, triggerManualAnalysis } = useKnowledgeAlignment({
    agentId,
    enabled: true,
  });

  useEffect(() => {
    fetchData();
  }, [agentId]);

  const fetchData = async () => {
    // Fetch agent safe mode status
    const { data: agent } = await supabase
      .from('agents')
      .select('first_alignment_completed_at')
      .eq('id', agentId)
      .single();

    if (agent?.first_alignment_completed_at) {
      const firstAnalysis = new Date(agent.first_alignment_completed_at);
      const now = new Date();
      const daysSinceFirst = (now.getTime() - firstAnalysis.getTime()) / (1000 * 60 * 60 * 24);
      const safeModeActive = daysSinceFirst < KNOWLEDGE_ALIGNMENT_CONFIG.safe_mode.duration_days;
      setSafeModeActive(safeModeActive);
      
      if (safeModeActive) {
        setDaysRemaining(Math.ceil(KNOWLEDGE_ALIGNMENT_CONFIG.safe_mode.duration_days - daysSinceFirst));
      }
    } else {
      setSafeModeActive(true);
      setDaysRemaining(KNOWLEDGE_ALIGNMENT_CONFIG.safe_mode.duration_days);
    }

    // Fetch analysis logs
    const { data: logs } = await supabase
      .from('alignment_analysis_log')
      .select('*')
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(10);

    if (logs) {
      setAnalysisLogs(logs);
      
      if (logs.length > 0) {
        const latest = logs[0];
        setStats({
          totalChunks: latest.total_chunks_analyzed,
          removedChunks: latest.chunks_auto_removed,
          conceptCoverage: latest.concept_coverage_percentage || 0,
        });
      }
    }

    // Fetch removed chunks
    const { data: removed } = await supabase
      .from('knowledge_removal_history')
      .select('*')
      .eq('agent_id', agentId)
      .is('restored_at', null)
      .order('removed_at', { ascending: false });

    if (removed) {
      setRemovedChunks(removed);
    }

    // Fetch active chunks count
    const { count } = await supabase
      .from('agent_knowledge')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .eq('is_active', true);

    if (count !== null) {
      setStats(prev => ({ ...prev, totalChunks: count }));
    }
  };

  const handleRestore = async () => {
    if (selectedChunks.size === 0) {
      toast.error('Seleziona almeno un chunk da ripristinare');
      return;
    }

    setIsRestoring(true);

    try {
      const { data, error } = await supabase.functions.invoke('restore-removed-chunks', {
        body: {
          agentId,
          chunkIds: Array.from(selectedChunks),
        },
      });

      if (error) throw error;

      toast.success(`${data.restored_count} chunk ripristinati con successo`);
      setSelectedChunks(new Set());
      fetchData();

    } catch (error: any) {
      console.error('Restore error:', error);
      toast.error('Errore durante il ripristino dei chunk');
    } finally {
      setIsRestoring(false);
    }
  };

  const toggleChunkSelection = (chunkId: string) => {
    const newSelection = new Set(selectedChunks);
    if (newSelection.has(chunkId)) {
      newSelection.delete(chunkId);
    } else {
      newSelection.add(chunkId);
    }
    setSelectedChunks(newSelection);
  };

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Allineamento AI della Knowledge Base</CardTitle>
              <CardDescription>
                Sistema autonomo di ottimizzazione della conoscenza
              </CardDescription>
            </div>
            <Button 
              onClick={triggerManualAnalysis} 
              disabled={isAnalyzing}
              size="sm"
            >
              <Play className="mr-2 h-4 w-4" />
              {isAnalyzing ? 'Analisi in corso...' : 'Analizza Ora'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            {safeModeActive ? (
              <>
                <Badge variant="secondary" className="gap-1">
                  <Shield className="h-3 w-3" />
                  Safe Mode Attivo
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {daysRemaining !== null && `${daysRemaining} giorni rimanenti`}
                </span>
              </>
            ) : (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Auto-Ottimizzazione Attiva
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Chunk Attivi</div>
              <div className="text-2xl font-bold">{stats.totalChunks}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Chunk Rimossi</div>
              <div className="text-2xl font-bold">{stats.removedChunks}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Copertura Concetti</div>
              <div className="space-y-1">
                <div className="text-2xl font-bold">{stats.conceptCoverage.toFixed(0)}%</div>
                <Progress value={stats.conceptCoverage} className="h-2" />
              </div>
            </div>
          </div>

          {lastAnalysis && (
            <div className="text-sm text-muted-foreground">
              Ultima analisi: {new Date(lastAnalysis).toLocaleString('it-IT')}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="removed" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="removed">Chunk Rimossi ({removedChunks.length})</TabsTrigger>
          <TabsTrigger value="history">Storico Analisi ({analysisLogs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="removed" className="space-y-4">
          {removedChunks.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <CheckCircle2 className="mx-auto h-12 w-12 mb-4 opacity-50" />
                <p>Nessun chunk rimosso</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {selectedChunks.size > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {selectedChunks.size} chunk selezionati
                  </span>
                  <Button
                    onClick={handleRestore}
                    disabled={isRestoring}
                    size="sm"
                    variant="outline"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {isRestoring ? 'Ripristino...' : 'Ripristina Selezionati'}
                  </Button>
                </div>
              )}

              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Documento</TableHead>
                      <TableHead>Contenuto</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Rimosso</TableHead>
                      <TableHead>Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {removedChunks.map((chunk) => (
                      <TableRow key={chunk.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedChunks.has(chunk.chunk_id)}
                            onChange={() => toggleChunkSelection(chunk.chunk_id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {chunk.document_name}
                        </TableCell>
                        <TableCell className="max-w-md">
                          <div className="truncate text-sm text-muted-foreground">
                            {chunk.content.substring(0, 100)}...
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {chunk.final_relevance_score?.toFixed(2)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(chunk.removed_at).toLocaleDateString('it-IT')}
                        </TableCell>
                        <TableCell className="text-sm">
                          {chunk.removal_reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {analysisLogs.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <AlertCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
                <p>Nessuna analisi ancora eseguita</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Chunk Analizzati</TableHead>
                    <TableHead>Rimossi</TableHead>
                    <TableHead>Copertura</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysisLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">
                        {new Date(log.started_at).toLocaleString('it-IT')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {log.trigger_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.total_chunks_analyzed}</TableCell>
                      <TableCell>
                        {log.chunks_auto_removed > 0 ? (
                          <span className="font-medium text-orange-600">
                            {log.chunks_auto_removed}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.concept_coverage_percentage?.toFixed(0)}%
                      </TableCell>
                      <TableCell>
                        {log.safe_mode_active ? (
                          <Badge variant="secondary">Safe Mode</Badge>
                        ) : (
                          <Badge variant="default">Auto</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
