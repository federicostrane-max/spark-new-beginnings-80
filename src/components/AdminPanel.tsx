import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, Database, CheckCircle, XCircle, FileText, ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProcessingLogs } from "./ProcessingLogs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OperationsDashboard } from "./OperationsDashboard";
import { FilterPromptEditor } from "./FilterPromptEditor";
import { AlignmentPromptEditor } from "./AlignmentPromptEditor";
import AlignmentMetricsMonitor from "./AlignmentMetricsMonitor";
import { AirtopBrowserAutomation } from "./AirtopBrowserAutomation";
import { LuxModeConfig } from "./LuxModeConfig";
import { ToolServerSettings } from "./ToolServerSettings";
import { useNavigate } from "react-router-dom";

interface ProcessingResult {
  id: string;
  file_name: string;
  status: string;
  text_length?: number;
  error?: string;
}

interface BatchSummary {
  processed: number;
  successful: number;
  errors: number;
  totalStuck: number;
  remainingStuck: number;
}

export const AdminPanel = () => {
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ProcessingResult[] | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [stuckCount, setStuckCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [activeTab, setActiveTab] = useState("metrics");

  const tabs = [
    { value: "metrics", label: "Metriche" },
    { value: "tools", label: "Strumenti" },
    { value: "logs", label: "Log Processing" },
    { value: "operations", label: "Operazioni" },
    { value: "filter-prompt", label: "Filter Prompt" },
    { value: "alignment-prompt", label: "Alignment Prompt" },
    { value: "lux-config", label: "Lux Config" },
    { value: "tool-server", label: "Tool Server" },
    { value: "airtop", label: "Airtop.ai" },
    { value: "docvqa", label: "DocVQA Test" },
    { value: "benchmark", label: "Benchmark" },
  ];

  const fetchStuckCount = async () => {
    setLoadingCount(true);
    try {
      // Count documents in processing states across all pipelines
      const [countA, countB, countC] = await Promise.all([
        supabase.from('pipeline_a_documents').select('*', { count: 'exact', head: true }).eq('status', 'processing'),
        supabase.from('pipeline_b_documents').select('*', { count: 'exact', head: true }).eq('status', 'processing'),
        supabase.from('pipeline_c_documents').select('*', { count: 'exact', head: true }).eq('status', 'processing'),
      ]);

      const totalCount = (countA.count || 0) + (countB.count || 0) + (countC.count || 0);
      setStuckCount(totalCount);
    } catch (error: any) {
      console.error('Error fetching stuck count:', error);
      toast.error('Errore nel recupero del conteggio documenti');
    } finally {
      setLoadingCount(false);
    }
  };

  const handleRetryFailedDocuments = async () => {
    setProcessing(true);
    const previousResults = results || [];

    try {
      console.log('🔄 Calling retry-failed-documents with batch limit 5...');
      
      const { data, error } = await supabase.functions.invoke('retry-failed-documents', {
        body: { limit: 5 }
      });

      if (error) {
        throw error;
      }

      console.log('✅ Processing complete:', data);
      
      // Append new results to previous ones
      setResults([...previousResults, ...(data.results || [])]);
      setSummary({
        processed: data.processed || 0,
        successful: data.successful || 0,
        errors: data.errors || 0,
        totalStuck: data.totalStuck || 0,
        remainingStuck: data.remainingStuck || 0
      });

      if (data.successful > 0) {
        const remainingMsg = data.remainingStuck > 0 
          ? ` - Rimangono ${data.remainingStuck} documenti da processare` 
          : ' - Tutti i documenti sono stati processati!';
        toast.success(`✅ Processati ${data.successful} documenti con successo!${remainingMsg}`);
      }
      
      if (data.errors > 0) {
        toast.error(`⚠️ ${data.errors} documento/i con errori`);
      }
      
      if (data.remainingStuck === 0 && data.totalStuck > 0) {
        toast.success('🎉 Tutti i documenti sono stati processati!');
      }

      // Update stuck count after processing
      await fetchStuckCount();

    } catch (error: any) {
      console.error('❌ Error:', error);
      toast.error(`Errore: ${error.message || 'Operazione fallita'}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full max-w-4xl mx-auto mt-8">
      {/* Mobile: Dropdown Select */}
      <div className="md:hidden mb-4">
        <Select value={activeTab} onValueChange={setActiveTab}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tabs.map((tab) => (
              <SelectItem key={tab.value} value={tab.value}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: Horizontal Tabs */}
      <TabsList className="hidden md:grid w-full grid-cols-11">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="metrics">
        <AlignmentMetricsMonitor />
      </TabsContent>

      <TabsContent value="tools">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Admin Panel - Manutenzione Database
            </CardTitle>
            <CardDescription>
              Strumenti per riparare e sincronizzare documenti
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
        {/* Retry Failed Documents */}
        <div className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold mb-1">Processa Documenti Validati (Batch)</h3>
            <p className="text-sm text-muted-foreground">
              Processa fino a 5 documenti alla volta che sono validati ma bloccati in stato "downloaded". 
              Se ci sono più documenti da processare, clicca il pulsante più volte.
            </p>
            {stuckCount !== null && (
              <div className="mt-2 text-sm font-medium">
                {stuckCount > 0 ? (
                  <span className="text-yellow-600">📋 {stuckCount} documento/i in attesa di processing</span>
                ) : (
                  <span className="text-green-600">✅ Nessun documento in attesa</span>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button 
              onClick={fetchStuckCount}
              disabled={loadingCount || processing}
              variant="outline"
              size="sm"
            >
              {loadingCount ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button 
              onClick={handleRetryFailedDocuments} 
              disabled={processing || stuckCount === 0}
              className="flex-1 sm:flex-none"
            >
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing Batch...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Processa Batch (max 5)
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <div className="font-semibold">Ultimo Batch:</div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Processati</div>
                      <div className="text-2xl font-bold">{summary.processed}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Successo</div>
                      <div className="text-2xl font-bold text-green-600">{summary.successful}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Errori</div>
                      <div className="text-2xl font-bold text-red-600">{summary.errors}</div>
                    </div>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            {summary.remainingStuck > 0 && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertDescription>
                  <div className="font-semibold">
                    ⚠️ Rimangono <span className="text-yellow-600">{summary.remainingStuck}</span> documenti da processare
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Clicca di nuovo il pulsante per processare il prossimo batch
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {summary.remainingStuck === 0 && summary.totalStuck > 0 && (
              <Alert className="border-green-500/50 bg-green-500/10">
                <AlertDescription>
                  <div className="font-semibold text-green-600">
                    ✅ Tutti i documenti sono stati processati!
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Results Table */}
        {results && results.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted px-4 py-2 font-semibold text-sm">
              Dettagli Processing ({results.length} documenti)
            </div>
            <div className="max-h-96 overflow-y-auto">
              {results.map((result, idx) => (
                <div 
                  key={result.id} 
                  className={`px-4 py-3 border-b last:border-b-0 ${
                    idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {result.status === 'success' ? (
                          <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                        )}
                        <span className="font-medium truncate" title={result.file_name}>
                          {result.file_name}
                        </span>
                      </div>
                      {result.status === 'success' && result.text_length && (
                        <p className="text-sm text-muted-foreground mt-1">
                          ✓ Estratti {result.text_length.toLocaleString()} caratteri
                        </p>
                      )}
                      {result.status === 'error' && result.error && (
                        <p className="text-sm text-red-600 mt-1">
                          ✗ {result.error}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {results && results.length === 0 && (
          <Alert>
            <AlertDescription>
              ✅ Nessun documento bloccato trovato! Tutti i documenti validati sono già stati processati.
            </AlertDescription>
          </Alert>
        )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="logs">
        <ProcessingLogs />
      </TabsContent>

      <TabsContent value="operations">
        <OperationsDashboard />
      </TabsContent>

      <TabsContent value="filter-prompt">
        <FilterPromptEditor />
      </TabsContent>

      <TabsContent value="alignment-prompt">
        <AlignmentPromptEditor />
      </TabsContent>

      <TabsContent value="lux-config">
        <LuxModeConfig />
      </TabsContent>

      <TabsContent value="tool-server">
        <ToolServerSettings />
      </TabsContent>

      <TabsContent value="airtop">
        <AirtopBrowserAutomation />
      </TabsContent>

      <TabsContent value="docvqa">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              DocVQA Test Dataset
            </CardTitle>
            <CardDescription>
              Dataset di benchmark per testare Pipeline A con documenti ibridi (testo + immagini)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Il dataset DocVQA contiene 20 documenti PDF con domande e risposte ground-truth per valutare 
                la capacità di Pipeline A di estrarre informazioni da documenti ibridi (testo + immagini).
              </p>
              <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-2">
                <p className="text-sm font-medium">📋 Caratteristiche Dataset:</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>20 documenti PDF (doc_0000.pdf - doc_0019.pdf)</li>
                  <li>Ogni documento ha 1+ domande con risposta attesa</li>
                  <li>Domande disponibili in 5 lingue (IT, EN, ES, FR, DE)</li>
                  <li>Test di recall semantico (date, nomi, numeri specifici)</li>
                </ul>
              </div>
            </div>
            
            <Button 
              onClick={() => navigate('/docvqa-test')}
              className="w-full gap-2"
            >
              Apri Dataset DocVQA
              <ExternalLink className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="benchmark">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              🧪 Benchmark Suite a 360°
            </CardTitle>
            <CardDescription>
              Test automatizzati su Finance, Charts, General e Safety con provisioning automatico da GitHub
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Sistema di benchmark completo con auto-provisioning di dataset da GitHub, generazione automatica 
                di file Markdown per FinQA e processing tramite Pipeline A-Hybrid.
              </p>
              <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-2">
                <p className="text-sm font-medium">🎯 Suite Disponibili:</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li><strong>Finance (FinQA):</strong> Tabelle finanziarie con domande numeriche</li>
                  <li><strong>Charts (ChartQA):</strong> Grafici e visualizzazioni dati (coming soon)</li>
                  <li><strong>General (DocVQA):</strong> Documenti ibridi testo + immagini</li>
                  <li><strong>Safety:</strong> Domande adversarial per testare robustezza</li>
                </ul>
              </div>
              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-sm font-medium text-blue-600">✨ Features:</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside mt-2">
                  <li>Auto-download da GitHub (FinQA, ChartQA)</li>
                  <li>Conversione automatica JSON → Markdown</li>
                  <li>Processing diretto senza LlamaParse (zero costi API)</li>
                  <li>Accuracy breakdown per categoria</li>
                  <li>LLM Judge per valutazione automatica</li>
                </ul>
              </div>
            </div>
            
            <Button 
              onClick={() => navigate('/benchmark')}
              className="w-full gap-2"
            >
              Apri Benchmark Dashboard
              <ExternalLink className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
};
