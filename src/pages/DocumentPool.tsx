import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, Loader2, AlertTriangle, FileX } from "lucide-react";
import { DocumentPoolTable } from "@/components/DocumentPoolTable";
import { DocumentPoolUpload } from "@/components/DocumentPoolUpload";
import { GitHubDocsImport } from "@/components/GitHubDocsImport";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function DocumentPool() {
  const navigate = useNavigate();
  const [needsMigration, setNeedsMigration] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [checkingMigration, setCheckingMigration] = useState(true);
  const [tableKey, setTableKey] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isCleaningChunks, setIsCleaningChunks] = useState(false);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [showReprocessDialog, setShowReprocessDialog] = useState(false);
  const [documentsWithoutChunks, setDocumentsWithoutChunks] = useState(0);
  
  // Health metrics
  const [healthMetrics, setHealthMetrics] = useState({
    ready: 0,
    processing: 0,
    orphanedChunks: 0,
    failed: 0
  });

  useEffect(() => {
    checkMigrationStatus();
    loadHealthMetrics();
    checkDocumentsWithoutChunks();
  }, []);

  const checkMigrationStatus = async () => {
    try {
      setCheckingMigration(true);
      
      // Check if there are any documents with source_type='direct_upload'
      const { count, error } = await supabase
        .from('agent_knowledge')
        .select('document_name', { count: 'exact', head: true })
        .eq('source_type', 'direct_upload');

      if (error) throw error;

      setNeedsMigration((count || 0) > 0);
      
      if ((count || 0) > 0) {
        console.log(`[Migration Check] Found ${count} chunks to migrate`);
      }
    } catch (error: any) {
      console.error('[Migration Check Error]', error);
    } finally {
      setCheckingMigration(false);
    }
  };

  const checkDocumentsWithoutChunks = async () => {
    try {
      // Get all ready documents
      const { data: docs } = await supabase
        .from('knowledge_documents')
        .select('id')
        .eq('processing_status', 'ready_for_assignment');

      if (!docs) return;

      let countWithoutChunks = 0;
      for (const doc of docs) {
        const { count } = await supabase
          .from('agent_knowledge')
          .select('id', { count: 'exact', head: true })
          .eq('pool_document_id', doc.id);

        if (count === 0) countWithoutChunks++;
      }

      setDocumentsWithoutChunks(countWithoutChunks);
    } catch (error) {
      console.error('[Check Docs Without Chunks] Error:', error);
    }
  };

  const loadHealthMetrics = async () => {
    try {
      const { count: readyCount } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .eq('processing_status', 'ready_for_assignment');

      // Usa RPC function per contare documenti in elaborazione
      const { data: processingCount } = await supabase
        .rpc('count_processing_documents');

      const { count: failedCount } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .in('processing_status', ['validation_failed', 'processing_failed']);

      setHealthMetrics({
        ready: readyCount || 0,
        processing: (processingCount as number) || 0,
        orphanedChunks: 0, // Calculated by cleanup function
        failed: failedCount || 0
      });
    } catch (error) {
      console.error('[Health Metrics] Error:', error);
    }
  };

  const handleUploadComplete = () => {
    setTableKey(prev => prev + 1);
    checkMigrationStatus();
    loadHealthMetrics();
    checkDocumentsWithoutChunks();
  };

  const handleRetryBlocked = async () => {
    setIsRetrying(true);
    try {
      toast.loading('Avvio validazione PDF bloccati...', { id: 'retry' });
      
      const { data, error } = await supabase.functions.invoke('retry-failed-documents');
      
      if (error) throw error;
      
      toast.success(
        'Validazione avviata! I PDF verranno processati nei prossimi minuti.',
        { id: 'retry', duration: 5000 }
      );
      
      setTimeout(() => {
        loadHealthMetrics();
        setTableKey(prev => prev + 1);
      }, 2000);
    } catch (err: any) {
      console.error('[Retry Error]', err);
      toast.error(`Errore: ${err.message}`, { id: 'retry' });
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCleanupChunks = async () => {
    setIsCleaningChunks(true);
    setShowCleanupDialog(false);
    
    try {
      toast.loading('Pulizia chunks duplicati in corso (batch processing)...', { id: 'cleanup' });
      
      const { data, error } = await supabase.functions.invoke('cleanup-duplicate-chunks');
      
      if (error) throw error;
      
      const results = data.results;
      toast.success(
        `Cleanup completato! Processati ${results.documentsProcessed} documenti in batch, rimossi ${results.duplicatesRemoved} chunks duplicati (${results.chunksBefore} → ${results.chunksAfter}).`,
        { id: 'cleanup', duration: 6000 }
      );
      
      setTimeout(() => {
        loadHealthMetrics();
        checkDocumentsWithoutChunks();
        setTableKey(prev => prev + 1);
      }, 2000);
      
    } catch (error: any) {
      console.error('[Cleanup Error]', error);
      toast.error(`Errore durante cleanup: ${error.message}`, { id: 'cleanup' });
    } finally {
      setIsCleaningChunks(false);
    }
  };

  const handleReprocessDocuments = async () => {
    setIsReprocessing(true);
    setShowReprocessDialog(false);
    
    try {
      let totalProcessed = 0;
      let totalSuccessful = 0;
      let totalFailed = 0;
      let totalChunks = 0;
      let hasMore = true;
      let batchNumber = 1;

      toast.loading('Riprocessamento batch 1 in corso...', { id: 'reprocess' });
      
      while (hasMore) {
        const { data, error } = await supabase.functions.invoke('reprocess-documents-without-chunks', {
          body: { batchSize: 5 }
        });
        
        if (error) {
          console.error(`[Batch ${batchNumber}] Error:`, error);
          break;
        }
        
        const { summary } = data;
        totalProcessed += summary.processed;
        totalSuccessful += summary.successful;
        totalFailed += summary.failed;
        totalChunks += summary.totalChunks;
        
        console.log(`[Batch ${batchNumber}] Processed: ${summary.processed}, Successful: ${summary.successful}, Failed: ${summary.failed}, Chunks: ${summary.totalChunks}`);
        
        // Se non ci sono più documenti da processare, esci
        if (summary.processed === 0) {
          hasMore = false;
        } else {
          batchNumber++;
          toast.loading(
            `Riprocessamento batch ${batchNumber} in corso... (${totalSuccessful} successi, ${totalFailed} falliti, ${totalChunks} chunk)`,
            { id: 'reprocess' }
          );
          // Pausa di 2 secondi tra un batch e l'altro
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      toast.success(
        `✅ Riprocessamento completato! ${totalSuccessful} documenti processati, ${totalChunks} chunk creati.${totalFailed > 0 ? ` ${totalFailed} documenti falliti.` : ''}`,
        { id: 'reprocess', duration: 10000 }
      );
      
      setTimeout(() => {
        loadHealthMetrics();
        checkDocumentsWithoutChunks();
        setTableKey(prev => prev + 1);
      }, 2000);
      
    } catch (error: any) {
      console.error('[Reprocess Error]', error);
      toast.error(`Errore durante il riprocessamento: ${error.message}`, { id: 'reprocess' });
    } finally {
      setIsReprocessing(false);
    }
  };

  const [testingExtraction, setTestingExtraction] = useState(false);

  const handleTestAggressiveExtraction = async () => {
    console.log('[Test Extraction] Button clicked, starting test...');
    setTestingExtraction(true);
    try {
      console.log('[Test Extraction] Invoking edge function...');
      toast.loading('Testing aggressive extraction...', { id: 'test-extraction' });
      
      const { data, error } = await supabase.functions.invoke('test-aggressive-extraction', {
        body: { strategies: ['content_inference'] }
      });
      
      console.log('[Test Extraction] Response received:', { data, error });
      console.log('[Test Extraction] Full response:', JSON.stringify(data, null, 2));
      
      if (error) {
        console.error('[Test Extraction] Error from function:', error);
        throw error;
      }
      
      if (!data) {
        console.error('[Test Extraction] No data received');
        throw new Error('No data received from function');
      }
      
      console.log('[Test Extraction] Result:', data);
      
      const result = data.results[0];
      const doc = data.document;

      if (result.success) {
        const titleInfo = result.title 
          ? `Title: "${result.title}"`
          : `No title found`;
        
        const authorsInfo = result.authors?.length > 0
          ? ` | Authors: ${result.authors.join(', ')}`
          : '';
        
        toast.success(
          `✓ ${doc.fileName}\n${titleInfo}${authorsInfo}\nConfidence: ${result.confidence} (${result.executionTimeMs}ms)`,
          { id: 'test-extraction', duration: 10000 }
        );
      } else {
        toast.error(
          `Failed to extract metadata: ${result.error}`,
          { id: 'test-extraction' }
        );
      }
      
    } catch (err: any) {
      console.error('[Test Extraction Failed]', err);
      toast.error('Test failed: ' + err.message, { id: 'test-extraction' });
    } finally {
      setTestingExtraction(false);
    }
  };

  const handleMigration = async () => {
    try {
      setMigrating(true);
      setShowMigrationDialog(false);
      
      toast.loading('Migrazione in corso...', { id: 'migration' });
      
      const { data, error } = await supabase.functions.invoke('migrate-agent-pdfs-to-pool');

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Migration failed');
      }

      const stats = data.stats;
      
      console.log('[Migration Complete]', stats);
      
      toast.success(
        `Migrazione completata! ${stats.documentsCreated} documenti creati, ${stats.linksCreated} link creati, ${stats.chunksUpdated} chunks aggiornati`,
        { id: 'migration', duration: 5000 }
      );

      if (stats.errors.length > 0) {
        toast.error(
          `Attenzione: ${stats.errors.length} errori durante la migrazione. Controlla i log.`,
          { duration: 5000 }
        );
      }

      // Refresh migration status and health
      await checkMigrationStatus();
      await loadHealthMetrics();
      
      // Trigger table refresh
      setTableKey(prev => prev + 1);
      
    } catch (error: any) {
      console.error('[Migration Error]', error);
      toast.error(`Errore durante la migrazione: ${error.message}`, { id: 'migration' });
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Torna alla Chat
          </Button>
          
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold">Pool Documenti Condivisi</h1>
              <p className="text-muted-foreground mt-2">
                Gestisci i documenti validati e assegnali ai tuoi agenti
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {!checkingMigration && needsMigration && (
              <Button
                onClick={() => setShowMigrationDialog(true)}
                disabled={migrating}
                variant="default"
                size="lg"
              >
                {migrating ? (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                    Migrazione in corso...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5" />
                    Migra PDF degli Agenti al Pool
                  </>
                )}
              </Button>
            )}
            
            <Button
              onClick={handleRetryBlocked}
              disabled={isRetrying}
              variant="secondary"
              size="lg"
            >
              {isRetrying ? (
                <>
                  <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                  Validazione...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-5 w-5" />
                  Riprova PDF Bloccati
                </>
              )}
            </Button>
            
            <Button
              onClick={handleTestAggressiveExtraction}
              disabled={testingExtraction}
              variant="outline"
              size="lg"
            >
              {testingExtraction ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <AlertTriangle className="mr-2 h-5 w-5" />
                  Test Aggressive Extraction
                </>
              )}
            </Button>
            
            <Button
              onClick={() => setShowCleanupDialog(true)}
              disabled={isCleaningChunks}
              variant="outline"
              size="lg"
              className="border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 text-orange-700 dark:text-orange-400"
            >
              {isCleaningChunks ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Pulizia...
                </>
              ) : (
                <>
                  <FileX className="mr-2 h-5 w-5" />
                  Pulisci Chunks Duplicati
                </>
              )}
            </Button>
            
            <Button
              onClick={() => setShowReprocessDialog(true)}
              disabled={isReprocessing || documentsWithoutChunks === 0}
              variant="outline"
              size="lg"
              className="border-purple-500/50 bg-purple-500/10 hover:bg-purple-500/20 text-purple-700 dark:text-purple-400"
            >
              {isReprocessing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Riprocessamento...
                </>
              ) : (
                <>
                  <FileX className="mr-2 h-5 w-5" />
                  Riprocessa Documenti Senza Chunk ({documentsWithoutChunks})
                </>
              )}
            </Button>
          </div>
        </div>

        {!checkingMigration && needsMigration && (
          <Alert className="bg-blue-500/10 border-blue-500 mb-6">
            <AlertCircle className="h-4 w-4 text-blue-500" />
            <AlertTitle className="text-blue-500">Migrazione Disponibile</AlertTitle>
            <AlertDescription>
              Sono stati trovati documenti PDF caricati direttamente negli agenti. 
              Clicca su "Migra PDF degli Agenti al Pool" per spostarli nel pool condiviso 
              e renderli disponibili per tutti gli agenti.
            </AlertDescription>
          </Alert>
        )}

        {/* Health Dashboard */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              📊 Stato Sistema Knowledge Base
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex flex-col items-center p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
                <div className="text-2xl font-bold text-green-500">{healthMetrics.ready}</div>
                <div className="text-sm text-muted-foreground text-center">Documenti Pronti</div>
              </div>
              
              <div className="flex flex-col items-center p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Loader2 className="h-8 w-8 text-blue-500 mb-2" />
                <div className="text-2xl font-bold text-blue-500">{healthMetrics.processing}</div>
                <div className="text-sm text-muted-foreground text-center">In Lavorazione</div>
              </div>
              
              <div className="flex flex-col items-center p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle className="h-8 w-8 text-yellow-500 mb-2" />
                <div className="text-2xl font-bold text-yellow-500">{healthMetrics.orphanedChunks}</div>
                <div className="text-sm text-muted-foreground text-center">Chunks da Rimuovere</div>
              </div>
              
              <div className="flex flex-col items-center p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <FileX className="h-8 w-8 text-red-500 mb-2" />
                <div className="text-2xl font-bold text-red-500">{healthMetrics.failed}</div>
                <div className="text-sm text-muted-foreground text-center">Con Errori</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mb-6 flex flex-col gap-4">
          <DocumentPoolUpload onUploadComplete={handleUploadComplete} />
          <GitHubDocsImport onImportComplete={handleUploadComplete} />
        </div>

        <DocumentPoolTable key={tableKey} />
      </div>

      {/* Migration Confirmation Dialog */}
      <AlertDialog open={showMigrationDialog} onOpenChange={setShowMigrationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma Migrazione</AlertDialogTitle>
            <AlertDialogDescription>
              Questa operazione migrerà tutti i PDF caricati negli agenti al pool condiviso.
              <br /><br />
              Tutti i documenti rimarranno automaticamente assegnati agli agenti originali,
              ma saranno anche disponibili per l'assegnazione ad altri agenti.
              <br /><br />
              Questa operazione è sicura e reversibile. Vuoi procedere?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleMigration}>
              Procedi con la Migrazione
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cleanup Chunks Confirmation Dialog */}
      <AlertDialog open={showCleanupDialog} onOpenChange={setShowCleanupDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma Pulizia Chunks Duplicati</AlertDialogTitle>
            <AlertDialogDescription>
              Questa operazione consoliderà tutti i chunks duplicati nel pool condiviso,
              rimuovendo le copie ridondanti dai singoli agent.
              <br /><br />
              L'operazione è sicura e può essere eseguita più volte senza problemi.
              <br /><br />
              Vuoi procedere?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleCleanupChunks}>
              Avvia Pulizia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reprocess Documents Confirmation Dialog */}
      <AlertDialog open={showReprocessDialog} onOpenChange={setShowReprocessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conferma Riprocessamento Documenti</AlertDialogTitle>
            <AlertDialogDescription>
              Questa operazione riprocesserà <strong>{documentsWithoutChunks}</strong> documento/i che non hanno chunk nel pool condiviso.
              <br /><br />
              Per ogni documento:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Estrarrà il testo dal PDF</li>
                <li>Creerà chunk di testo con overlap</li>
                <li>Genererà embeddings usando OpenAI</li>
                <li>Salverà i chunk nel pool condiviso</li>
              </ul>
              <br />
              I documenti che non possono essere processati (file corrotto, testo non estraibile) verranno marcati come <strong>"validation_failed"</strong>.
              <br /><br />
              <strong>Batch size:</strong> 5 documenti alla volta per evitare timeout.
              <br /><br />
              Vuoi procedere?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleReprocessDocuments}>
              Avvia Riprocessamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
