import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, Database, CheckCircle, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProcessingLogs } from "./ProcessingLogs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ProcessingResult {
  id: string;
  file_name: string;
  status: string;
  text_length?: number;
  error?: string;
}

export const AdminPanel = () => {
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ProcessingResult[] | null>(null);
  const [summary, setSummary] = useState<{
    processed: number;
    successful: number;
    errors: number;
  } | null>(null);

  const handleRetryFailedDocuments = async () => {
    setProcessing(true);
    setResults(null);
    setSummary(null);

    try {
      console.log('🔄 Calling retry-failed-documents...');
      
      // Timeout più lungo per gestire il delay tra documenti (90 secondi)
      const timeout = 90000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const { data, error } = await supabase.functions.invoke('retry-failed-documents', {
        body: {},
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (error) {
        // Se è un timeout, mostra un messaggio più informativo
        if (error.message?.includes('aborted') || error.message?.includes('timeout')) {
          toast.warning('⏱️ Timeout - Il processo continua in background. Ricarica la pagina tra qualche minuto.');
          setProcessing(false);
          return;
        }
        throw error;
      }

      console.log('✅ Processing complete:', data);
      
      setResults(data.results || []);
      setSummary({
        processed: data.processed || 0,
        successful: data.successful || 0,
        errors: data.errors || 0
      });

      if (data.successful > 0) {
        toast.success(`✅ ${data.successful} documento/i processato/i con successo!`);
      }
      
      if (data.errors > 0) {
        toast.error(`⚠️ ${data.errors} documento/i con errori`);
      }

    } catch (error: any) {
      console.error('❌ Error:', error);
      
      // Gestione specifica per timeout o abort
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        toast.warning('⏱️ Timeout raggiunto - Il processo continua in background. Ricarica la pagina tra qualche minuto per vedere i risultati.');
      } else {
        toast.error(`Errore: ${error.message || 'Operazione fallita'}`);
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Tabs defaultValue="tools" className="w-full max-w-4xl mx-auto mt-8">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="tools">Strumenti</TabsTrigger>
        <TabsTrigger value="logs">Log Real-time</TabsTrigger>
      </TabsList>

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
            <h3 className="text-lg font-semibold mb-1">Processa Documenti Validati</h3>
            <p className="text-sm text-muted-foreground">
              Trova e processa tutti i documenti che sono validati ma non hanno chunks in agent_knowledge
              (documenti bloccati in stato "downloaded"). 
              ⏱️ Nota: Con molti documenti, il processo può richiedere diversi minuti.
            </p>
          </div>

          <Button 
            onClick={handleRetryFailedDocuments} 
            disabled={processing}
            className="w-full sm:w-auto"
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Processa Documenti Bloccati
              </>
            )}
          </Button>
        </div>

        {/* Summary */}
        {summary && (
          <Alert>
            <AlertDescription>
              <div className="space-y-2">
                <div className="font-semibold">Riepilogo Processing:</div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Totale</div>
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
    </Tabs>
  );
};
