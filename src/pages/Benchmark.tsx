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
import { ArrowLeft, PlayCircle, CheckCircle, XCircle, AlertCircle, Clock, Settings, RefreshCw } from "lucide-react";
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
  charts: '📈 Charts (ChartQA)',
  receipts: '🧾 Receipts (CORD)',
  science: '🔬 Science (QASPER)',
  narrative: '📖 Narrative (Deep Understanding)',
  code: '💻 Code (GitHub)',
  safety: '🛡️ Safety (Adversarial)',
  hybrid: '🔬 Hybrid PDF (Visual Test)',
  trading: '📊 TradingView Pro'
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

  useEffect(() => {
    loadDataset();
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

  const loadDataset = async () => {
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

  const runBenchmark = async () => {
    console.log('[BENCHMARK DEBUG] runBenchmark function called!');
    try {
      setIsRunning(true);
      setProgress(0);
      const newResults: BenchmarkResult[] = [];
      
      // Generate unique run_id for this benchmark execution
      const runId = crypto.randomUUID();
      console.log(`🎯 [BENCHMARK] Starting run ${runId}`);
      toast.info(`Benchmark Run ID: ${runId.substring(0, 8)}...`);

      // Filter dataset by selected suite while preserving original indices
      const filteredDatasetWithIndex = dataset
        .map((entry, originalIndex) => ({ entry, originalIndex }))
        .filter(item => selectedSuite === 'all' || item.entry.suite_category === selectedSuite);
      
      // Diagnostic logging
      console.log('[Benchmark] Configuration:', {
        selectedSuite,
        totalDatasetLength: dataset.length,
        filteredDatasetLength: filteredDatasetWithIndex.length,
        agentSlug: AGENT_SLUG
      });
      
      if (filteredDatasetWithIndex.length === 0) {
        toast.error('Nessun documento trovato per la suite selezionata');
        setIsRunning(false);
        return;
      }

      console.log('[BENCHMARK DEBUG] About to start loop with', filteredDatasetWithIndex.length, 'items');

      for (let i = 0; i < filteredDatasetWithIndex.length; i++) {
        const { entry, originalIndex } = filteredDatasetWithIndex[i];
        
        // Detect format (benchmark_datasets vs legacy)
        const isNewFormat = 'file_name' in entry;
        const fileName = isNewFormat ? entry.file_name : entry.pdf_file;
        const questionText = isNewFormat ? entry.question : entry.qa_pairs[0].question.en;
        const groundTruth = isNewFormat ? entry.ground_truth : entry.qa_pairs[0].answer;
        
        const question = `Regarding document '${fileName}': ${questionText}`;

        setCurrentDoc({ index: originalIndex, file: fileName, question });
        
        const result: BenchmarkResult = {
          pdf_file: fileName,
          question,
          groundTruth,
          status: 'running'
        };

        // Update UI with running status
        setResults(prev => {
          const updated = [...prev];
          updated[originalIndex] = result;
          return updated;
        });

        try {
          // 1. Check if document exists and is ready
          const { data: doc, error: docError } = await supabase
            .from('pipeline_a_hybrid_documents')
            .select('id, status')
            .eq('file_name', fileName)
            .maybeSingle();

        if (docError) throw docError;

        if (!doc) {
          result.status = 'missing';
          result.error = 'Documento non presente nel pool';
          newResults.push(result);
          setResults(prev => {
            const updated = [...prev];
            updated[originalIndex] = result;
            return updated;
          });
          
          // Save to database
          await supabase.from('benchmark_results').insert({
            run_id: runId,
            pdf_file: fileName,
            question,
            ground_truth: groundTruth,
            status: 'missing',
            error: result.error
          });
          
          continue;
        }

        if (doc.status !== 'ready') {
          result.status = 'not_ready';
          result.error = `Documento in status: ${doc.status}`;
          newResults.push(result);
          setResults(prev => {
            const updated = [...prev];
            updated[originalIndex] = result;
            return updated;
          });
          
          // Save to database
          await supabase.from('benchmark_results').insert({
            run_id: runId,
            pdf_file: fileName,
            question,
            ground_truth: groundTruth,
            status: 'not_ready',
            error: result.error
          });
          
          continue;
        }

          // 2. Send question to agent with isolated conversation
          const conversationId = crypto.randomUUID(); // Generate random ID for complete isolation
          const startTime = Date.now();
          const { data: agentData, error: agentError } = await supabase.functions.invoke('agent-chat', {
            body: {
              agentSlug: AGENT_SLUG,
              message: question,
              conversationId, // Force new conversation per test
              stream: false // Disable streaming for benchmark
            }
          });

          if (agentError) throw agentError;
          
          // Diagnostic logging to see full response structure
          console.log('[Benchmark] Agent response structure:', JSON.stringify(agentData, null, 2));
          
          // Handle multiple possible response field names
          const agentResponse = agentData?.response || agentData?.message || agentData?.reply || agentData?.content || '';
          
          if (!agentResponse) {
            console.error('[Benchmark] Empty agent response! Full data:', agentData);
            result.status = 'error';
            result.error = 'Agent returned empty response';
            result.responseTimeMs = Date.now() - startTime;
            newResults.push(result);
            setResults(prev => {
              const updated = [...prev];
              updated[originalIndex] = result;
              return updated;
            });
            
            await supabase.from('benchmark_results').insert({
              run_id: runId,
              pdf_file: fileName,
              question,
              ground_truth: groundTruth,
              status: 'failed',
              error: 'Agent returned empty response',
              response_time_ms: result.responseTimeMs
            });
            
            continue;
          }
          
          result.agentResponse = agentResponse;
          result.responseTimeMs = Date.now() - startTime;
          console.log('[Benchmark] Extracted response:', agentResponse);

          // 3. Evaluate with LLM Judge (pass suiteCategory for conditional prompt selection)
          const suiteCategory = isNewFormat ? entry.suite_category : 'general';
          const { data: evaluation, error: evalError } = await supabase.functions.invoke('evaluate-answer', {
            body: {
              question,
              agentResponse,
              groundTruths: [groundTruth],
              suiteCategory // NEW: enables REASONING_JUDGE_PROMPT for narrative/science
            }
          });

          if (evalError) throw evalError;
          if (!evaluation) throw new Error('No evaluation data returned from judge');
          if (evaluation.error) throw new Error(`Judge error: ${evaluation.error}`);

          result.correct = evaluation.correct;
          result.reason = evaluation.reason;
          result.status = 'completed';
          newResults.push(result);
          
          // Save to database with retrieval metadata
          await supabase.from('benchmark_results').insert({
            run_id: runId,
            pdf_file: fileName,
            question,
            ground_truth: groundTruth,
            agent_response: agentResponse,
            correct: evaluation.correct,
            reason: evaluation.reason,
            response_time_ms: result.responseTimeMs,
            status: 'completed',
            retrieval_metadata: agentData?.metadata || {}
          });

        } catch (error: any) {
          result.status = 'error';
          result.error = error.message;
          newResults.push(result);
          
          // Save error to database
          await supabase.from('benchmark_results').insert({
            run_id: runId,
            pdf_file: fileName,
            question,
            ground_truth: groundTruth,
            status: 'error',
            error: error.message
          });
        }

        // Update results and progress
        setResults(prev => {
          const updated = [...prev];
          updated[originalIndex] = result;
          return updated;
        });
        setProgress(((i + 1) / filteredDatasetWithIndex.length) * 100);
      }

      setIsRunning(false);
      setCurrentDoc(null);
      toast.success(`Benchmark completato! Run ID: ${runId.substring(0, 8)}...`);
    } catch (error: any) {
      console.error('[Benchmark] Critical error in runBenchmark:', error);
      toast.error(`Errore critico nel benchmark: ${error.message}`);
      setIsRunning(false);
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
          <Button
            variant="outline"
            onClick={async () => {
              setResults([]);
              setDataset([]);
              await loadDataset();
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
            disabled={isRunning || dataset.length === 0}
            size="sm"
            className="gap-2"
          >
            <PlayCircle className="h-4 w-4 md:h-5 md:w-5" />
            {isRunning ? 'In Corso...' : 'Avvia'}
          </Button>
        </div>
      </div>

      {/* Provisioning Dialog */}
      <Dialog open={showProvisioning} onOpenChange={setShowProvisioning}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Configura Dataset di Benchmark</DialogTitle>
            <DialogDescription>
              Scarica automaticamente dataset da GitHub e configura le suite di test
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="narrative" 
                checked={provisionSuites.narrative}
                onCheckedChange={(checked) => 
                  setProvisionSuites(prev => ({ ...prev, narrative: !!checked }))
                }
              />
              <Label htmlFor="narrative" className="font-normal cursor-pointer">
                📖 Narrative (NarrativeQA) - Deep understanding
              </Label>
            </div>
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
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="hybrid" 
                checked={provisionSuites.hybrid}
                onCheckedChange={(checked) => 
                  setProvisionSuites(prev => ({ ...prev, hybrid: !!checked }))
                }
              />
              <Label htmlFor="hybrid" className="font-normal cursor-pointer">
                🔬 Hybrid PDF (ArXiv) - Test Visual Enrichment
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="trading" 
                checked={provisionSuites.trading}
                onCheckedChange={(checked) => 
                  setProvisionSuites(prev => ({ ...prev, trading: !!checked }))
                }
              />
              <Label htmlFor="trading" className="font-normal cursor-pointer">
                📊 TradingView Pro - Financial Charts Analysis
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sampleSize">Sample Size per Suite</Label>
              <Input 
                id="sampleSize"
                type="number" 
                min={1}
                max={20}
                value={sampleSize} 
                onChange={(e) => setSampleSize(parseInt(e.target.value) || 5)} 
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
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
