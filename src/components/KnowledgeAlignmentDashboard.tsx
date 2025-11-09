import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, XCircle, AlertCircle, RotateCcw, Play, Shield, Loader2, AlertTriangle, Info, TrendingUp, TrendingDown, Clock, RefreshCw, Target } from 'lucide-react';
import { toast } from 'sonner';
import { useKnowledgeAlignment } from '@/hooks/useKnowledgeAlignment';
import { KNOWLEDGE_ALIGNMENT_CONFIG } from '@/config/knowledgeAlignmentConfig';
import GapAnalysisView from './GapAnalysisView';

interface KnowledgeAlignmentDashboardProps {
  agentId: string;
}

interface AnalysisLog {
  id: string;
  started_at: string;
  completed_at: string | null;
  total_chunks_analyzed: number;
  progress_chunks_analyzed: number;
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
  const [progressChunks, setProgressChunks] = useState(0);
  const [totalChunksInAnalysis, setTotalChunksInAnalysis] = useState(0);
  const [isAnalyzingGaps, setIsAnalyzingGaps] = useState(false);
  const [gapAnalysisRefresh, setGapAnalysisRefresh] = useState(0);
  const [stats, setStats] = useState({
    totalChunks: 0,
    removedChunks: 0,
    conceptCoverage: 0,
  });

  const { 
    isAnalyzing, 
    lastAnalysis,
    lastAnalysisStatus,
    cooldownActive,
    cooldownMinutes,
    canAnalyze,
    triggerManualAnalysis,
    forceAnalysis,
  } = useKnowledgeAlignment({
    agentId,
    enabled: true,
  });

  useEffect(() => {
    fetchData();
  }, [agentId]);

  // Poll for updates when analyzing - fetch progress from DB
  useEffect(() => {
    if (!isAnalyzing) return;

    const interval = setInterval(async () => {
      // Fetch latest analysis log for real-time progress
      const { data: log } = await supabase
        .from('alignment_analysis_log')
        .select('progress_chunks_analyzed, total_chunks_analyzed')
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

        if (log) {
          setProgressChunks(log.progress_chunks_analyzed || 0);
          // Non usiamo log.total_chunks_analyzed perché rappresenta il batch size (1000),
          // non il totale reale dei chunk. Usiamo stats.totalChunks invece.
      }

      fetchData();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [isAnalyzing, agentId]);

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
        
        // Calculate real coverage from scores
        const { data: scores } = await supabase
          .from('knowledge_relevance_scores')
          .select('concept_coverage')
          .eq('agent_id', agentId);
        
        const realCoverage = scores && scores.length > 0
          ? (scores.reduce((sum, s) => sum + (s.concept_coverage || 0), 0) / scores.length) * 100
          : latest.concept_coverage_percentage || 0;

      // Non sovrascriviamo totalChunks perché latest.total_chunks_analyzed
      // rappresenta il batch size (1000), non il totale reale dei chunk
      setStats(prev => ({
        ...prev,
        removedChunks: latest.chunks_auto_removed,
        conceptCoverage: realCoverage,
      }));
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
      // Settiamo anche totalChunksInAnalysis per il calcolo del progresso durante l'analisi
      setTotalChunksInAnalysis(count);
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

  const handleAnalyzeGaps = async () => {
    setIsAnalyzingGaps(true);
    try {
      const { data, error } = await supabase.functions.invoke('detailed-gap-analysis', {
        body: { agentId }
      });

      if (error) throw error;
      
      toast.success('Analisi gap completata! I risultati sono ora visibili nel tab "Gap Mancanti".');
      
      // Trigger refresh del GapAnalysisView
      setGapAnalysisRefresh(prev => prev + 1);
      
    } catch (error: any) {
      console.error('Gap analysis error:', error);
      toast.error('Errore durante l\'analisi dei gap');
    } finally {
      setIsAnalyzingGaps(false);
    }
  };

  // Determine analysis status
  const getAnalysisStatus = () => {
    if (isAnalyzing) return 'running';
    if (analysisLogs.length === 0) return 'idle';
    
    const latest = analysisLogs[0];
    if (!latest.completed_at) return 'incomplete';
    if (stats.conceptCoverage < 30) return 'low_coverage';
    return 'completed';
  };

  const analysisStatus = getAnalysisStatus();

  // Calculate progress percentage - use real-time data when analyzing
  const progressPercentage = isAnalyzing && totalChunksInAnalysis > 0
    ? (progressChunks / totalChunksInAnalysis) * 100
    : (analysisLogs.length > 0 && stats.totalChunks > 0
      ? ((analysisLogs[0].progress_chunks_analyzed || 0) / stats.totalChunks) * 100
      : 0);

  // Estimate remaining time (assuming ~10 chunks per second)
  const estimatedRemainingMinutes = isAnalyzing && totalChunksInAnalysis > 0
    ? Math.ceil((totalChunksInAnalysis - progressChunks) / 10 / 60)
    : 0;

  // Get coverage badge variant
  const getCoverageBadge = (coverage: number) => {
    if (coverage >= 80) return { variant: 'default' as const, label: 'Ottima', icon: TrendingUp, color: 'text-green-600' };
    if (coverage >= 60) return { variant: 'default' as const, label: 'Buona', icon: TrendingUp, color: 'text-blue-600' };
    if (coverage >= 30) return { variant: 'secondary' as const, label: 'Bassa', icon: TrendingDown, color: 'text-yellow-600' };
    return { variant: 'destructive' as const, label: 'Critica', icon: AlertTriangle, color: 'text-red-600' };
  };

  const coverageBadge = getCoverageBadge(stats.conceptCoverage);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Alert cooldown */}
        {cooldownActive && lastAnalysisStatus === 'completed' && !isAnalyzing && (
          <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
            <Clock className="h-5 w-5 text-yellow-600" />
            <AlertTitle className="text-yellow-900 dark:text-yellow-100">
              Cooldown Attivo
            </AlertTitle>
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              Prossima analisi disponibile tra {cooldownMinutes} minuti. Questo previene sovraccarichi del sistema.
            </AlertDescription>
          </Alert>
        )}

        {/* Alert analisi incompleta */}
        {lastAnalysisStatus === 'incomplete' && !isAnalyzing && (
          <Alert className="border-red-500 bg-red-50 dark:bg-red-950">
            <XCircle className="h-5 w-5 text-red-600" />
            <AlertTitle className="text-red-900 dark:text-red-100">
              Analisi Incompleta
            </AlertTitle>
            <AlertDescription className="flex items-center justify-between text-red-800 dark:text-red-200">
              <span>L'ultima analisi non è stata completata. Puoi riprovare ora.</span>
              <Button 
                onClick={forceAnalysis}
                size="sm"
                variant="destructive"
                className="ml-4"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Riavvia Analisi
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Alert analisi in corso */}
        {analysisStatus === 'running' && (
          <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <AlertTitle className="text-blue-900 dark:text-blue-100">Analisi Knowledge Base in Corso</AlertTitle>
            <AlertDescription className="space-y-2 text-blue-800 dark:text-blue-200">
              <div className="flex justify-between items-center">
                <span className="font-mono text-lg">
                  {progressChunks}/{totalChunksInAnalysis} chunk
                </span>
                <span className="font-semibold">{progressPercentage.toFixed(1)}%</span>
              </div>
              <Progress value={progressPercentage} className="h-3" />
              {estimatedRemainingMinutes > 0 && (
                <p className="text-xs mt-1">
                  ⏱️ Tempo stimato rimanente: ~{estimatedRemainingMinutes} minut{estimatedRemainingMinutes === 1 ? 'o' : 'i'}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {analysisStatus === 'low_coverage' && (
          <Alert variant="destructive" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <AlertTitle className="text-yellow-900 dark:text-yellow-100">Coverage Bassa Rilevata</AlertTitle>
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              Solo il {stats.conceptCoverage.toFixed(0)}% dei concetti sono coperti. Considera di aggiungere più documenti pertinenti ai Task Requirements.
            </AlertDescription>
          </Alert>
        )}

        {analysisStatus === 'incomplete' && (
          <Alert variant="destructive">
            <XCircle className="h-5 w-5" />
            <AlertTitle>Analisi Incompleta</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>L'analisi si è fermata a {analysisLogs[0]?.progress_chunks_analyzed || 0}/{stats.totalChunks} chunk. Click per riavviare.</span>
              <Button onClick={triggerManualAnalysis} size="sm" variant="outline" className="ml-4">
                <Play className="mr-2 h-4 w-4" />
                Riavvia Analisi
              </Button>
            </AlertDescription>
          </Alert>
        )}

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
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button 
                      onClick={triggerManualAnalysis} 
                      disabled={isAnalyzing || !canAnalyze}
                      size="sm"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      {isAnalyzing ? 'Analisi in corso...' : 'Analizza Ora'}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canAnalyze && cooldownActive && (
                  <TooltipContent>
                    <p>Prossima analisi disponibile tra {cooldownMinutes} minuti</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Safe Mode Badge */}
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
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">Durante i primi 7 giorni, i chunk vengono solo identificati ma non rimossi automaticamente</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Auto-Ottimizzazione Attiva
                </Badge>
              )}
            </div>

            {/* Progress Section - Only show when analyzing */}
            {isAnalyzing && totalChunksInAnalysis > 0 && (
              <div className="p-4 border rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="font-semibold">Analisi in Corso</span>
                  </div>
                  <span className="text-sm font-mono text-muted-foreground">
                    {progressPercentage.toFixed(1)}% completato
                  </span>
                </div>
                <div className="space-y-2">
                  <Progress value={progressPercentage} className="h-4" />
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-3xl tabular-nums">{progressChunks}</span>
                    <span className="text-muted-foreground">/ {totalChunksInAnalysis} chunk</span>
                  </div>
                  {estimatedRemainingMinutes > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>Tempo stimato: ~{estimatedRemainingMinutes} minut{estimatedRemainingMinutes === 1 ? 'o' : 'i'}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Statistics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2 p-4 border rounded-lg">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Chunk Attivi</span>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Numero totale di chunk nella knowledge base dell'agente</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-3xl font-bold">{stats.totalChunks}</div>
                  <Badge variant="secondary" className="text-xs">attivi</Badge>
                </div>
              </div>

              <div className="space-y-2 p-4 border rounded-lg">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Chunk Rimossi</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-3xl font-bold">{stats.removedChunks}</div>
                  {stats.removedChunks > 0 && (
                    <Badge variant="outline" className="text-xs text-orange-600">rimossi</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2 p-4 border rounded-lg">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Copertura Concetti</span>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="font-semibold mb-1">Qualità Media Knowledge Base</p>
                      <p className="text-xs">Misura quanto ciascun chunk esistente copre i concetti richiesti. Un valore basso indica che i chunk nel KB coprono solo parzialmente i task requirements, anche se numericamente presenti.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`text-3xl font-bold ${coverageBadge.color}`}>
                      {stats.conceptCoverage.toFixed(0)}%
                    </div>
                    <Badge variant={coverageBadge.variant} className="gap-1">
                      <coverageBadge.icon className="h-3 w-3" />
                      {coverageBadge.label}
                    </Badge>
                  </div>
                  <Progress value={stats.conceptCoverage} className="h-3" />
                </div>
              </div>
            </div>

            {lastAnalysis && !isAnalyzing && (
              <div className="text-sm text-muted-foreground">
                Ultima analisi: {new Date(lastAnalysis).toLocaleString('it-IT')}
              </div>
            )}
          </CardContent>
        </Card>

      {/* Tabs */}
      <Tabs defaultValue="gaps" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="gaps">
            <Target className="mr-2 h-4 w-4" />
            Gap Mancanti
          </TabsTrigger>
          <TabsTrigger value="removed">Chunk Rimossi ({removedChunks.length})</TabsTrigger>
          <TabsTrigger value="history">Storico Analisi ({analysisLogs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="gaps" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Analisi Gap Dettagliata</CardTitle>
                  <CardDescription>
                    Scopri esattamente cosa manca nel knowledge base per ogni categoria di requisiti
                  </CardDescription>
                </div>
                <Button 
                  onClick={handleAnalyzeGaps}
                  disabled={isAnalyzingGaps || isAnalyzing}
                  size="sm"
                >
                  <Target className="mr-2 h-4 w-4" />
                  {isAnalyzingGaps ? 'Analisi in corso...' : 'Analizza Gap Dettagliati'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <GapAnalysisView agentId={agentId} refreshTrigger={gapAnalysisRefresh} />
            </CardContent>
          </Card>
        </TabsContent>

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
    </TooltipProvider>
  );
};
