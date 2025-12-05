import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ArrowLeft, PlayCircle, CheckCircle, XCircle, AlertCircle, Clock, Settings, RefreshCw, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface QAPair {
  question: {
    it: string;
    en: string;
  };
  answer: string;
}

interface DatasetEntry {
  doc_id: string;
  pdf_file: string;
  image_file: string;
  qa_pairs: QAPair[];
}

interface BenchmarkResult {
  pdf_file: string;
  question: string;
  groundTruth: string;
  agentResponse?: string;
  correct?: boolean;
  reason?: string;
  responseTimeMs?: number;
  status: 'pending' | 'running' | 'completed' | 'missing' | 'not_ready' | 'error';
  error?: string;
}

const AGENT_SLUG = "book-serach-expert"; // Book Search Expert (Pipeline A-Hybrid)

const SUITE_LABELS = {
  all: '🎯 Tutti i Test',
  general: '📄 General (DocVQA)',
  finance: '📊 Finance (FinQA)',
  financebench: '💼 FinanceBench (10-K Reports)',
  charts: '📈 Charts (ChartQA)',
  receipts: '🧾 Receipts (CORD)',
  science: '🔬 Science (QASPER)',
  narrative: '📖 Narrative (Deep Understanding)',
  code: '💻 Code (GitHub)',
  safety: '🛡️ Safety (Adversarial)',
  hybrid: '🔬 Hybrid PDF (Visual Test)',
  trading: '📊 TradingView Pro'
};

// Maximum available documents per suite (from source repos/APIs)
const SUITE_MAX_DOCS: Record<string, number> = {
  general: 5000,      // DocVQA validation set
  finance: 8000,      // FinQA train.json
  financebench: 150,  // FinanceBench Q&A pairs
  charts: 10000,      // ChartQA dataset
  receipts: 1000,     // CORD dataset
  science: 1500,      // QASPER dataset
  narrative: 1500,    // NarrativeQA
  code: 100,          // GitHub samples
  safety: 20,         // Adversarial questions pool
  hybrid: 5,          // ArXiv test papers
  trading: 5          // TradingView hardcoded tests
};

export default function Benchmark() {
  const navigate = useNavigate();
  const [dataset, setDataset] = useState<any[]>([]);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentDoc, setCurrentDoc] = useState<{ index: number; file: string; question: string } | null>(null);
  const [selectedSuite, setSelectedSuite] = useState<string>('all');
  const [showProvisioning, setShowProvisioning] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionSuites, setProvisionSuites] = useState({ 
    general: true, 
    finance: true,
    financebench: true,
    charts: true, 
    receipts: true, 
    science: true,
    narrative: true,
    code: true,
    safety: true,
    hybrid: true,
    trading: true
  });
  const [sampleSize, setSampleSize] = useState(5);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [availableRuns, setAvailableRuns] = useState<Array<{ run_id: string; created_at: string; total: number }>>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const init = async () => {
      const runs = await loadAvailableRuns();
      await loadDataset(false, runs);
    };
    init();
  }, []);

  const handleRegenerateTableEmbeddings = async () => {
    setIsRegenerating(true);
    
    try {
      toast.info('Avvio rigenerazione embedding tabelle...');
      
      const { data, error } = await supabase.functions.invoke('regenerate-table-embeddings', {
        body: {}
      });

      if (error) throw error;

      const result = data as { success: boolean; processed: number; failed: number; total: number; message: string };
      
      if (result.success) {
        toast.success(`✅ ${result.message}`, { duration: 5000 });
        
        if (result.failed > 0) {
          toast.warning(`⚠️ ${result.failed} chunk non rigenerati. Controlla i log.`, { duration: 5000 });
        }
      } else {
        throw new Error('Regeneration failed');
      }
      
    } catch (error) {
      console.error('Regenerate embeddings error:', error);
      toast.error('Errore durante la rigenerazione degli embedding');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleExportPdf = async () => {
    if (!selectedRunId) {
      toast.error('Seleziona un run da esportare');
      return;
    }

    setIsExporting(true);
    try {
      toast.info('Generazione report PDF in corso...');
      
      const { data, error } = await supabase.functions.invoke('export-benchmark-pdf', {
        body: { runId: selectedRunId }
      });

      if (error) throw error;

      if (data?.success && data?.url) {
        toast.success(`✅ Report HTML generato! ${data.stats?.correct}/${data.stats?.total} corrette (${data.stats?.accuracy}%). Usa Stampa > Salva come PDF`);
        // Open HTML in new tab
        window.open(data.url, '_blank');
      } else {
        throw new Error(data?.error || 'Export failed');
      }
      
    } catch (error) {
      console.error('Export PDF error:', error);
      toast.error('Errore durante l\'esportazione PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const loadAvailableRuns = async (): Promise<Array<{ run_id: string; created_at: string; total: number }>> => {
    try {
      const { data, error } = await supabase
        .from('benchmark_results')
        .select('run_id, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Group by run_id and get metadata
      const runsMap = new Map<string, { run_id: string; created_at: string; total: number }>();
      data?.forEach(row => {
        if (!runsMap.has(row.run_id)) {
          runsMap.set(row.run_id, {
            run_id: row.run_id,
            created_at: row.created_at,
            total: 1
          });
        } else {
          const existing = runsMap.get(row.run_id)!;
          existing.total++;
        }
      });

      const runs = Array.from(runsMap.values());
      setAvailableRuns(runs);
      return runs;
    } catch (error) {
      console.error('Error loading runs:', error);
      return [];
    }
  };

  const loadHistoricalResults = async (runId: string) => {
    setIsLoadingHistorical(true);
    try {
      const { data, error } = await supabase
        .from('benchmark_results')
        .select('*')
        .eq('run_id', runId);

      if (error) throw error;

      // Merge with dataset to preserve structure
      const mergedResults: BenchmarkResult[] = dataset.map(entry => {
        const dbResult = data?.find(r => r.pdf_file === entry.file_name && r.question.includes(entry.question));
        if (dbResult) {
          return {
            pdf_file: dbResult.pdf_file,
            question: dbResult.question,
            groundTruth: dbResult.ground_truth,
            agentResponse: dbResult.agent_response || undefined,
            correct: dbResult.correct || undefined,
            reason: dbResult.reason || undefined,
            responseTimeMs: dbResult.response_time_ms || undefined,
            status: dbResult.status === 'completed' ? 'completed' : 
                    dbResult.status === 'missing' ? 'missing' :
                    dbResult.status === 'not_ready' ? 'not_ready' :
                    dbResult.status === 'error' ? 'error' : 'pending',
            error: dbResult.error || undefined
          };
        }
        return {
          pdf_file: entry.file_name,
          question: `Regarding document '${entry.file_name}': ${entry.question}`,
          groundTruth: entry.ground_truth,
          status: 'pending'
        };
      });

      setResults(mergedResults);
      setSelectedRunId(runId);
      toast.success(`Caricato run storico: ${runId.substring(0, 8)}...`);
    } catch (error) {
      console.error('Error loading historical results:', error);
      toast.error('Errore caricamento risultati storici');
    } finally {
      setIsLoadingHistorical(false);
    }
  };

  const loadDataset = async (skipAutoLoad: boolean = false, runsOverride?: Array<{ run_id: string; created_at: string; total: number }>) => {
    try {
      // 🔧 FIX: Reset state before loading to prevent stale data
      setResults([]);
      setDataset([]);
      
      // Load from benchmark_datasets table
      const { data, error } = await supabase
        .from('benchmark_datasets')
        .select('*')
        .eq('is_active', true)
        .order('suite_category')
        .order('created_at');

      if (error) throw error;
      
      if (data && data.length > 0) {
        setDataset(data);
        
        // Initialize results with document context
        const initialResults: BenchmarkResult[] = data.map(entry => ({
          pdf_file: entry.file_name,
          question: `Regarding document '${entry.file_name}': ${entry.question}`,
          groundTruth: entry.ground_truth,
          status: 'pending'
        }));
        setResults(initialResults);

        // 🔧 AUTO-LOAD: Load latest completed run if exists (use runsOverride to avoid race condition)
        const runs = runsOverride || availableRuns;
        if (!skipAutoLoad && runs.length > 0) {
          const latestRun = runs[0];
          await loadHistoricalResults(latestRun.run_id);
        }
      } else {
        // Fallback to legacy JSON if no database entries
        const response = await fetch('/data/docvqa-annotations.json');
        const legacyData: DatasetEntry[] = await response.json();
        
        const convertedData = legacyData.map(entry => ({
          file_name: entry.pdf_file,
          suite_category: 'general',
          question: entry.qa_pairs[0].question.en,
          ground_truth: entry.qa_pairs[0].answer,
          source_repo: 'local'
        }));
        
        setDataset(convertedData);
        
        const initialResults: BenchmarkResult[] = convertedData.map(entry => ({
          pdf_file: entry.file_name,
          question: `Regarding document '${entry.file_name}': ${entry.question}`,
          groundTruth: entry.ground_truth,
          status: 'pending'
        }));
        setResults(initialResults);
      }
    } catch (error) {
      console.error('Error loading dataset:', error);
      toast.error('Errore caricamento dataset');
    }
  };

  const handleProvisioning = async () => {
    setIsProvisioning(true);
    try {
      const { data, error } = await supabase.functions.invoke('provision-benchmark-datasets', {
        body: { suites: provisionSuites, sampleSize }
      });

      if (error) throw error;
      
      toast.success(`Provisioning completato! ${data.message}`);
      
      // 🔧 FIX: Small delay to ensure all DB operations are committed
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 🔧 FIX: Force complete state reset and reload
      setResults([]);
      setDataset([]);
      await loadDataset();
      setShowProvisioning(false);
    } catch (error: any) {
      console.error('Provisioning error:', error);
      toast.error(`Errore provisioning: ${error.message}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  // SERVER-SIDE BENCHMARK EXECUTION
  // This runs entirely on the server - no browser dependency!
  const runBenchmark = async () => {
    console.log('[BENCHMARK] Starting SERVER-SIDE benchmark execution');
    
    try {
      setIsRunning(true);
      setProgress(10);
      
      // Determine suite to run
      const suite = selectedSuite === 'all' ? 'financebench' : selectedSuite;
      
      toast.info(`🚀 Avvio benchmark server-side per suite: ${suite}`, { duration: 5000 });
      console.log(`[BENCHMARK] Invoking run-benchmark edge function with suite: ${suite}`);
      
      // Call server-side benchmark execution
      const { data, error } = await supabase.functions.invoke('run-benchmark', {
        body: {
          suite,
          limit: 100 // Process up to 100 questions
        }
      });
      
      if (error) {
        console.error('[BENCHMARK] Edge function error:', error);
        throw new Error(`Edge function error: ${error.message}`);
      }
      
      console.log('[BENCHMARK] Server response:', data);
      
      if (!data?.success) {
        throw new Error(data?.error || 'Unknown server error');
      }
      
      // Handle async job-based response
      const { run_id, total_jobs, message } = data;
      setProgress(50);
      
      toast.success(
        `🚀 ${message || 'Benchmark avviato!'}\n` +
        `Run ID: ${run_id?.substring(0, 8)}...\n` +
        `Jobs creati: ${total_jobs}`,
        { duration: 8000 }
      );
      
      // Start polling for results
      setSelectedRunId(run_id);
      
      // Poll for job completion
      let pollCount = 0;
      const maxPolls = 120; // 10 minutes max
      const pollInterval = setInterval(async () => {
        pollCount++;
        
        const { data: jobStatus } = await supabase
          .from('benchmark_jobs_queue')
          .select('status')
          .eq('run_id', run_id);
        
        const pending = jobStatus?.filter(j => j.status === 'pending' || j.status === 'processing').length || 0;
        const completed = jobStatus?.filter(j => j.status === 'completed' || j.status === 'failed').length || 0;
        const total = jobStatus?.length || total_jobs;
        
        setProgress(50 + Math.round((completed / total) * 50));
        
        if (pending === 0 || pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setProgress(100);
          
          // Load final results
          await loadHistoricalResults(run_id);
          await loadAvailableRuns();
          
          toast.success(`✅ Benchmark completato! ${completed}/${total} jobs processati`);
          setIsRunning(false);
        }
      }, 5000);
      
    } catch (error: any) {
      console.error('[BENCHMARK] Critical error:', error);
      toast.error(`❌ Errore benchmark: ${error.message}`);
      setIsRunning(false);
    } finally {
      setCurrentDoc(null);
    }
  };

  // Filter results by selected suite
  const filteredResults = selectedSuite === 'all' 
    ? results 
    : results.filter((_, idx) => dataset[idx]?.suite_category === selectedSuite);

  const stats = {
    total: filteredResults.length,
    passed: filteredResults.filter(r => r.status === 'completed' && r.correct).length,
    failed: filteredResults.filter(r => r.status === 'completed' && !r.correct).length,
    missing: filteredResults.filter(r => r.status === 'missing').length,
    notReady: filteredResults.filter(r => r.status === 'not_ready').length,
    errors: filteredResults.filter(r => r.status === 'error').length,
    avgTime: filteredResults.filter(r => r.responseTimeMs).length > 0
      ? (filteredResults.reduce((sum, r) => sum + (r.responseTimeMs || 0), 0) / 
         filteredResults.filter(r => r.responseTimeMs).length / 1000).toFixed(2)
      : '0.00',
    accuracy: filteredResults.filter(r => r.status === 'completed').length > 0
      ? Math.round((filteredResults.filter(r => r.status === 'completed' && r.correct).length / 
         filteredResults.filter(r => r.status === 'completed').length) * 100)
      : 0
  };

  // Stats per suite
  const statsBySuite = Object.keys(SUITE_LABELS).reduce((acc, suite) => {
    const suiteResults = suite === 'all' ? results : results.filter((_, idx) => dataset[idx]?.suite_category === suite);
    const completed = suiteResults.filter(r => r.status === 'completed');
    acc[suite] = {
      total: suiteResults.length,
      passed: completed.filter(r => r.correct).length,
      accuracy: completed.length > 0 
        ? Math.round((completed.filter(r => r.correct).length / completed.length) * 100) 
        : 0
    };
    return acc;
  }, {} as any);

  const getStatusBadge = (result: BenchmarkResult) => {
    switch (result.status) {
      case 'pending':
        return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />In Attesa</Badge>;
      case 'running':
        return <Badge variant="outline" className="gap-1 bg-blue-50"><Clock className="h-3 w-3 animate-spin" />In Corso</Badge>;
      case 'completed':
        return result.correct ? (
          <Badge variant="outline" className="gap-1 bg-green-50 text-green-700 border-green-200">
            <CheckCircle className="h-3 w-3" />PASS
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 bg-red-50 text-red-700 border-red-200">
            <XCircle className="h-3 w-3" />FAIL
          </Badge>
        );
      case 'missing':
        return <Badge variant="outline" className="gap-1 bg-yellow-50 text-yellow-700 border-yellow-200">
          <AlertCircle className="h-3 w-3" />Non Presente
        </Badge>;
      case 'not_ready':
        return <Badge variant="outline" className="gap-1 bg-orange-50 text-orange-700 border-orange-200">
          <AlertCircle className="h-3 w-3" />In Elaborazione
        </Badge>;
      case 'error':
        return <Badge variant="outline" className="gap-1 bg-red-50 text-red-700 border-red-200">
          <XCircle className="h-3 w-3" />Errore
        </Badge>;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Indietro
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">🧪 Benchmark Suite a 360°</h1>
            <p className="text-sm md:text-base text-muted-foreground mt-1">
              Test automatizzati su Finance, Charts, General e Safety
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={selectedSuite} onValueChange={setSelectedSuite}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SUITE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {/* Historical Run Selector */}
          <Select 
            value={selectedRunId || 'new'} 
            onValueChange={(value) => {
              if (value === 'new') {
                setSelectedRunId(null);
                loadDataset(true);
              } else {
                loadHistoricalResults(value);
              }
            }}
            disabled={isLoadingHistorical}
          >
            <SelectTrigger className="w-full sm:w-[280px]">
              <SelectValue placeholder="Seleziona Run..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">🆕 Nuovo Benchmark</SelectItem>
              {availableRuns.map(run => (
                <SelectItem key={run.run_id} value={run.run_id}>
                  📊 {new Date(run.created_at).toLocaleString('it-IT')} ({run.total} test)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedRunId && (
            <Badge variant="outline" className="gap-2 px-3 py-1.5">
              Run: {selectedRunId.substring(0, 8)}...
            </Badge>
          )}

          <Button
            variant="outline"
            onClick={async () => {
              setResults([]);
              setDataset([]);
              setSelectedRunId(null);
              await loadDataset(true);
              await loadAvailableRuns();
              toast.success('Dataset ricaricato');
            }}
            size="sm"
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowProvisioning(true)}
            size="sm"
            className="gap-2"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Configura Dataset</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleRegenerateTableEmbeddings}
            disabled={isRegenerating}
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">{isRegenerating ? 'Rigenerando...' : 'Rigenera Embedding Tabelle'}</span>
          </Button>
          <Button
            onClick={runBenchmark}
            disabled={isRunning || dataset.length === 0 || selectedRunId !== null}
            size="sm"
            className="gap-2"
          >
            <PlayCircle className="h-4 w-4 md:h-5 md:w-5" />
            {isRunning ? 'In Corso...' : 'Avvia'}
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPdf}
            disabled={isExporting || !selectedRunId}
            size="sm"
            className="gap-2"
          >
            <FileDown className={`h-4 w-4 ${isExporting ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{isExporting ? 'Esportando...' : 'Export PDF'}</span>
          </Button>
        </div>
      </div>

      {/* Provisioning Dialog */}
      <Dialog open={showProvisioning} onOpenChange={setShowProvisioning}>
        <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Configura Dataset di Benchmark</DialogTitle>
            <DialogDescription>
              Scarica automaticamente dataset da GitHub e configura le suite di test
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="general" 
                  checked={provisionSuites.general}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, general: !!checked }))
                  }
                />
                <Label htmlFor="general" className="font-normal cursor-pointer">
                  📄 General (DocVQA) - Documenti generici
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.general.toLocaleString()}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="finance" 
                  checked={provisionSuites.finance}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, finance: !!checked }))
                  }
                />
                <Label htmlFor="finance" className="font-normal cursor-pointer">
                  📊 Finance (FinQA) - Tabelle finanziarie
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.finance.toLocaleString()}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="financebench" 
                  checked={provisionSuites.financebench}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, financebench: !!checked }))
                  }
                />
                <Label htmlFor="financebench" className="font-normal cursor-pointer">
                  💼 FinanceBench - 10-K Reports
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.financebench}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="charts" 
                  checked={provisionSuites.charts}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, charts: !!checked }))
                  }
                />
                <Label htmlFor="charts" className="font-normal cursor-pointer">
                  📈 Charts (ChartQA) - Grafici visivi
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.charts.toLocaleString()}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="receipts" 
                  checked={provisionSuites.receipts}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, receipts: !!checked }))
                  }
                />
                <Label htmlFor="receipts" className="font-normal cursor-pointer">
                  🧾 Receipts (CORD) - Scontrini e fatture
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.receipts.toLocaleString()}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="science" 
                  checked={provisionSuites.science}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, science: !!checked }))
                  }
                />
                <Label htmlFor="science" className="font-normal cursor-pointer">
                  🔬 Science (QASPER) - Paper scientifici
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.science.toLocaleString()}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="narrative" 
                  checked={provisionSuites.narrative}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, narrative: !!checked }))
                  }
                />
                <Label htmlFor="narrative" className="font-normal cursor-pointer">
                  📖 Narrative - Deep understanding
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.narrative.toLocaleString()}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="code" 
                  checked={provisionSuites.code}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, code: !!checked }))
                  }
                />
                <Label htmlFor="code" className="font-normal cursor-pointer">
                  💻 Code (GitHub) - Codice sorgente
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.code}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="safety" 
                  checked={provisionSuites.safety}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, safety: !!checked }))
                  }
                />
                <Label htmlFor="safety" className="font-normal cursor-pointer">
                  🛡️ Safety - Domande adversarial
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.safety}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="hybrid" 
                  checked={provisionSuites.hybrid}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, hybrid: !!checked }))
                  }
                />
                <Label htmlFor="hybrid" className="font-normal cursor-pointer">
                  🔬 Hybrid PDF (ArXiv) - Visual Enrichment
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.hybrid}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="trading" 
                  checked={provisionSuites.trading}
                  onCheckedChange={(checked) => 
                    setProvisionSuites(prev => ({ ...prev, trading: !!checked }))
                  }
                />
                <Label htmlFor="trading" className="font-normal cursor-pointer">
                  📊 TradingView Pro - Charts Analysis
                </Label>
              </div>
              <Badge variant="outline" className="text-xs">max {SUITE_MAX_DOCS.trading}</Badge>
            </div>
            
            {/* Sample Size with dynamic max */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label htmlFor="sampleSize">Sample Size per Suite</Label>
                <span className="text-xs text-muted-foreground">
                  Max effettivo: {Math.min(
                    ...Object.entries(provisionSuites)
                      .filter(([_, enabled]) => enabled)
                      .map(([suite]) => SUITE_MAX_DOCS[suite] || 1000)
                  )}
                </span>
              </div>
              <Input 
                id="sampleSize"
                type="number" 
                min={1}
                max={Math.min(
                  ...Object.entries(provisionSuites)
                    .filter(([_, enabled]) => enabled)
                    .map(([suite]) => SUITE_MAX_DOCS[suite] || 1000)
                )}
                value={sampleSize || ''} 
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setSampleSize(0);
                  } else {
                    const num = parseInt(val);
                    const maxAllowed = Math.min(
                      ...Object.entries(provisionSuites)
                        .filter(([_, enabled]) => enabled)
                        .map(([suite]) => SUITE_MAX_DOCS[suite] || 1000)
                    );
                    if (!isNaN(num)) {
                      setSampleSize(Math.min(maxAllowed, Math.max(0, num)));
                    }
                  }
                }}
                onBlur={() => {
                  if (!sampleSize || sampleSize < 1) setSampleSize(1);
                  const maxAllowed = Math.min(
                    ...Object.entries(provisionSuites)
                      .filter(([_, enabled]) => enabled)
                      .map(([suite]) => SUITE_MAX_DOCS[suite] || 1000)
                  );
                  if (sampleSize > maxAllowed) setSampleSize(maxAllowed);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Scaricherà al massimo questo numero di documenti per ogni suite selezionata
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => setShowProvisioning(false)}>
              Annulla
            </Button>
            <Button onClick={handleProvisioning} disabled={isProvisioning}>
              {isProvisioning ? 'Provisioning...' : 'Avvia Download'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Progress Section */}
      {isRunning && currentDoc && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Elaborando: {currentDoc.file}</span>
                <span className="text-muted-foreground">{currentDoc.index + 1}/{dataset.length}</span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-muted-foreground truncate">{currentDoc.question}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats per Suite - Responsive Grid */}
      {dataset.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {Object.entries(SUITE_LABELS).map(([suite, label]) => (
            <Card key={suite} className={selectedSuite === suite ? 'ring-2 ring-primary' : ''}>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs truncate">{label}</CardDescription>
                <CardTitle className="text-2xl">{statsBySuite[suite]?.accuracy || 0}%</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {statsBySuite[suite]?.passed || 0}/{statsBySuite[suite]?.total || 0} test
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Stats Cards */}
      {filteredResults.some(r => r.status === 'completed') && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Accuratezza</CardDescription>
              <CardTitle className="text-4xl">{stats.accuracy}%</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Passed</CardDescription>
              <CardTitle className="text-4xl text-green-600">{stats.passed}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Failed</CardDescription>
              <CardTitle className="text-4xl text-red-600">{stats.failed}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Tempo Medio</CardDescription>
              <CardTitle className="text-4xl">{stats.avgTime}s</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Results Table - Responsive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl md:text-2xl">Risultati Dettagliati</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            {stats.missing > 0 && `${stats.missing} documenti non presenti • `}
            {stats.notReady > 0 && `${stats.notReady} documenti in elaborazione • `}
            {stats.errors > 0 && `${stats.errors} errori • `}
            {results.filter(r => r.status === 'completed').length} test completati
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto -mx-2 md:mx-0">
          <div className="inline-block min-w-full align-middle">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[100px] md:min-w-[120px] text-xs md:text-sm">PDF File</TableHead>
                  <TableHead className="min-w-[150px] md:min-w-[200px] text-xs md:text-sm">Domanda</TableHead>
                  <TableHead className="min-w-[80px] md:min-w-[100px] text-xs md:text-sm">Expected</TableHead>
                  <TableHead className="min-w-[150px] md:min-w-[200px] text-xs md:text-sm">Risposta Agente</TableHead>
                  <TableHead className="min-w-[80px] md:min-w-[100px] text-xs md:text-sm">Esito</TableHead>
                  <TableHead className="min-w-[60px] md:min-w-[80px] text-xs md:text-sm">Tempo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResults.map((result, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-[10px] md:text-xs whitespace-nowrap">{result.pdf_file}</TableCell>
                    <TableCell className="max-w-[150px] md:max-w-[200px] truncate text-xs md:text-sm" title={result.question}>
                      {result.question}
                    </TableCell>
                    <TableCell className="font-medium text-[10px] md:text-xs">{result.groundTruth}</TableCell>
                    <TableCell className="max-w-[150px] md:max-w-[300px] truncate text-xs md:text-sm" title={result.agentResponse || result.error}>
                      {result.agentResponse ? (
                        <span>{result.agentResponse}</span>
                      ) : result.error ? (
                        <span className="text-red-600">{result.error}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{getStatusBadge(result)}</TableCell>
                    <TableCell className="text-xs md:text-sm whitespace-nowrap">
                      {result.responseTimeMs ? `${(result.responseTimeMs / 1000).toFixed(1)}s` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
