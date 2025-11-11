import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, Loader2, AlertTriangle, FileX } from "lucide-react";
import { DocumentPoolTable } from "@/components/DocumentPoolTable";
import { DocumentPoolUpload } from "@/components/DocumentPoolUpload";
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
  };

  const handleRetryBlocked = async () => {
    setIsRetrying(true);
    try {
      toast.loading('Reset PDF bloccati...', { id: 'retry' });
      
      // Step 1: Reset stuck PDFs to pending status
      const { data: resetData, error: resetError } = await supabase.functions.invoke('reset-stuck-queue-pdfs');
      
      if (resetError) throw resetError;
      
      const { resetCount, conversationIds } = resetData;
      
      if (resetCount === 0) {
        toast.info('Nessun PDF bloccato trovato', { id: 'retry' });
        return;
      }
      
      toast.loading(`${resetCount} PDF resettati, avvio processamento...`, { id: 'retry' });
      
      // Step 2: Process queue for each affected conversation
      for (const conversationId of conversationIds) {
        await supabase.functions.invoke('process-pdf-queue', {
          body: { conversationId }
        });
      }
      
      toast.success(
        `${resetCount} PDF in elaborazione! Riceverai notifiche real-time per ogni step.`,
        { id: 'retry', duration: 5000 }
      );
      
      // Refresh UI after a delay
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

        <div className="mb-6">
          <DocumentPoolUpload onUploadComplete={handleUploadComplete} />
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
    </div>
  );
}
