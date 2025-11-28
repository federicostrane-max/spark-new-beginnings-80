import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, PlayCircle, CheckCircle, XCircle, AlertCircle, Clock } from "lucide-react";
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

export default function Benchmark() {
  const navigate = useNavigate();
  const [dataset, setDataset] = useState<DatasetEntry[]>([]);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentDoc, setCurrentDoc] = useState<{ index: number; file: string; question: string } | null>(null);

  useEffect(() => {
    loadDataset();
  }, []);

  const loadDataset = async () => {
    try {
      const response = await fetch('/data/docvqa-annotations.json');
      const data: DatasetEntry[] = await response.json();
      setDataset(data);
      
      // Initialize results
      const initialResults: BenchmarkResult[] = data.map(entry => ({
        pdf_file: entry.pdf_file,
        question: entry.qa_pairs[0].question.en,
        groundTruth: entry.qa_pairs[0].answer,
        status: 'pending'
      }));
      setResults(initialResults);
    } catch (error) {
      console.error('Error loading dataset:', error);
      toast.error('Errore caricamento dataset');
    }
  };

  const runBenchmark = async () => {
    setIsRunning(true);
    setProgress(0);
    const newResults: BenchmarkResult[] = [];
    
    // Generate unique run_id for this benchmark execution
    const runId = crypto.randomUUID();
    console.log(`🎯 [BENCHMARK] Starting run ${runId}`);
    toast.info(`Benchmark Run ID: ${runId.substring(0, 8)}...`);

    for (let i = 0; i < dataset.length; i++) {
      const entry = dataset[i];
      const question = entry.qa_pairs[0].question.en;
      const groundTruth = entry.qa_pairs[0].answer;

      setCurrentDoc({ index: i, file: entry.pdf_file, question });
      
      const result: BenchmarkResult = {
        pdf_file: entry.pdf_file,
        question,
        groundTruth,
        status: 'running'
      };

      // Update UI with running status
      setResults(prev => {
        const updated = [...prev];
        updated[i] = result;
        return updated;
      });

      try {
        // 1. Check if document exists and is ready
        const { data: doc, error: docError } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('id, status')
          .eq('file_name', entry.pdf_file)
          .maybeSingle();

        if (docError) throw docError;

        if (!doc) {
          result.status = 'missing';
          result.error = 'Documento non presente nel pool';
          newResults.push(result);
          setResults(prev => {
            const updated = [...prev];
            updated[i] = result;
            return updated;
          });
          
          // Save to database
          await supabase.from('benchmark_results').insert({
            run_id: runId,
            pdf_file: entry.pdf_file,
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
            updated[i] = result;
            return updated;
          });
          
          // Save to database
          await supabase.from('benchmark_results').insert({
            run_id: runId,
            pdf_file: entry.pdf_file,
            question,
            ground_truth: groundTruth,
            status: 'not_ready',
            error: result.error
          });
          
          continue;
        }

        // 2. Send question to agent (non-streaming mode)
        const startTime = Date.now();
        const { data: agentData, error: agentError } = await supabase.functions.invoke('agent-chat', {
          body: {
            agentSlug: AGENT_SLUG,
            message: question,
            stream: false // Disable streaming for benchmark
          }
        });

        if (agentError) throw agentError;
        
        const agentResponse = agentData?.response || '';
        result.agentResponse = agentResponse;
        result.responseTimeMs = Date.now() - startTime;

        // 3. Evaluate with LLM Judge
        const { data: evaluation, error: evalError } = await supabase.functions.invoke('evaluate-answer', {
          body: {
            question,
            agentResponse,
            groundTruths: [groundTruth]
          }
        });

        if (evalError) throw evalError;

        result.correct = evaluation.correct;
        result.reason = evaluation.reason;
        result.status = 'completed';
        newResults.push(result);
        
        // Save to database with retrieval metadata
        await supabase.from('benchmark_results').insert({
          run_id: runId,
          pdf_file: entry.pdf_file,
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
          pdf_file: entry.pdf_file,
          question,
          ground_truth: groundTruth,
          status: 'error',
          error: error.message
        });
      }

      // Update results and progress
      setResults(prev => {
        const updated = [...prev];
        updated[i] = result;
        return updated;
      });
      setProgress(((i + 1) / dataset.length) * 100);
    }

    setIsRunning(false);
    setCurrentDoc(null);
    toast.success(`Benchmark completato! Run ID: ${runId.substring(0, 8)}...`);
  };

  const stats = {
    total: results.length,
    passed: results.filter(r => r.status === 'completed' && r.correct).length,
    failed: results.filter(r => r.status === 'completed' && !r.correct).length,
    missing: results.filter(r => r.status === 'missing').length,
    notReady: results.filter(r => r.status === 'not_ready').length,
    errors: results.filter(r => r.status === 'error').length,
    avgTime: results.filter(r => r.responseTimeMs).length > 0
      ? (results.reduce((sum, r) => sum + (r.responseTimeMs || 0), 0) / 
         results.filter(r => r.responseTimeMs).length / 1000).toFixed(2)
      : '0.00',
    accuracy: results.filter(r => r.status === 'completed').length > 0
      ? Math.round((results.filter(r => r.status === 'completed' && r.correct).length / 
         results.filter(r => r.status === 'completed').length) * 100)
      : 0
  };

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Indietro
          </Button>
          <div>
            <h1 className="text-3xl font-bold">🧪 DocVQA Benchmark</h1>
            <p className="text-muted-foreground mt-1">
              Test di accuratezza dell'Agente su 20 documenti con domande predefinite
            </p>
          </div>
        </div>
        <Button
          onClick={runBenchmark}
          disabled={isRunning || dataset.length === 0}
          size="lg"
          className="gap-2"
        >
          <PlayCircle className="h-5 w-5" />
          {isRunning ? 'Benchmark In Corso...' : 'Avvia Benchmark'}
        </Button>
      </div>

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

      {/* Stats Cards */}
      {results.some(r => r.status === 'completed') && (
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

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle>Risultati Dettagliati</CardTitle>
          <CardDescription>
            {stats.missing > 0 && `${stats.missing} documenti non presenti • `}
            {stats.notReady > 0 && `${stats.notReady} documenti in elaborazione • `}
            {stats.errors > 0 && `${stats.errors} errori • `}
            {results.filter(r => r.status === 'completed').length} test completati
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">PDF File</TableHead>
                <TableHead>Domanda</TableHead>
                <TableHead className="w-[120px]">Expected</TableHead>
                <TableHead>Risposta Agente</TableHead>
                <TableHead className="w-[120px]">Esito</TableHead>
                <TableHead className="w-[80px]">Tempo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-mono text-xs">{result.pdf_file}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm" title={result.question}>
                    {result.question}
                  </TableCell>
                  <TableCell className="font-medium text-xs">{result.groundTruth}</TableCell>
                  <TableCell className="max-w-[300px] truncate text-sm" title={result.agentResponse || result.error}>
                    {result.agentResponse ? (
                      <span>{result.agentResponse}</span>
                    ) : result.error ? (
                      <span className="text-red-600">{result.error}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(result)}</TableCell>
                  <TableCell className="text-sm">
                    {result.responseTimeMs ? `${(result.responseTimeMs / 1000).toFixed(1)}s` : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
