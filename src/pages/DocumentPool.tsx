import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, Loader2, AlertTriangle, FileX, MoreVertical, Info } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const [isRecovering, setIsRecovering] = useState(false);
  const [showRecoverDialog, setShowRecoverDialog] = useState(false);
  const [documentsWithoutFulltext, setDocumentsWithoutFulltext] = useState(0);
  const [isCleaningBroken, setIsCleaningBroken] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairReport, setRepairReport] = useState<any>(null);
  const [showRepairReport, setShowRepairReport] = useState(false);

  // Backup & restore states
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<any>(null);
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isRecategorizing, setIsRecategorizing] = useState(false);
  
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
    checkDocumentsWithoutFulltext();
    loadBackups();
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

  const checkDocumentsWithoutFulltext = async () => {
    try {
      const { count } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .is('full_text', null)
        .eq('processing_status', 'ready_for_assignment')
        .eq('validation_status', 'validated');
      
      setDocumentsWithoutFulltext(count || 0);
    } catch (error) {
      console.error('[Check Fulltext] Error:', error);
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

  const loadBackups = async () => {
    try {
      const { data, error } = await supabase
        .from('document_assignment_backups')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setBackups(data || []);
    } catch (error) {
      console.error('[Load Backups] Error:', error);
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
    checkDocumentsWithoutFulltext();
    loadBackups();
  };

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      toast.loading('Creazione backup in corso...', { id: 'backup' });
      
      const { data, error } = await supabase.functions.invoke('verify-and-backup-assignments', {
        body: {
          backupName: `Backup ${new Date().toLocaleString('it-IT')}`,
          backupDescription: 'Backup automatico delle assegnazioni documenti problematici'
        }
      });

      if (error) throw error;

      toast.success(
        `✅ Backup creato! ${data.summary.totalDocuments} documenti, ${data.summary.totalAssignments} assegnazioni.\n📁 File trovati: ${data.summary.filesFound}\n❌ File mancanti: ${data.summary.filesMissing}`,
        { id: 'backup', duration: 8000 }
      );

      await loadBackups();
    } catch (error: any) {
      console.error('[Create Backup Error]', error);
      toast.error(`Errore durante la creazione del backup: ${error.message}`, { id: 'backup' });
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    setIsRestoring(true);
    try {
      toast.loading('Ripristino assegnazioni in corso...', { id: 'restore' });
      
      const { data, error } = await supabase.functions.invoke('restore-assignments-from-backup', {
        body: { backupId }
      });

      if (error) throw error;

      toast.success(
        `✅ Ripristino completato! ${data.summary.assignmentsRestored} assegnazioni ripristinate, ${data.summary.syncSuccesses} sincronizzazioni riuscite.`,
        { id: 'restore', duration: 8000 }
      );

      await loadBackups();
      setShowBackupDialog(false);
      setTableKey(prev => prev + 1);
    } catch (error: any) {
      console.error('[Restore Backup Error]', error);
      toast.error(`Errore durante il ripristino: ${error.message}`, { id: 'restore' });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRecategorizeGitHub = async () => {
    setIsRecategorizing(true);
    try {
      toast.loading('Ricategorizzazione documenti GitHub in corso...', { id: 'recat' });
      
      const { data, error } = await supabase.functions.invoke('recategorize-github-docs');
      
      if (error) throw error;
      
      toast.success(
        `✅ Ricategorizzazione completata! ${data.updatedCount} documenti aggiornati.`,
        { id: 'recat', duration: 5000 }
      );
      
      setTableKey(prev => prev + 1);
    } catch (error: any) {
      console.error('[Recategorize Error]', error);
      toast.error(`Errore: ${error.message}`, { id: 'recat' });
    } finally {
      setIsRecategorizing(false);
    }
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
        checkDocumentsWithoutFulltext();
        setTableKey(prev => prev + 1);
      }, 2000);
      
    } catch (error: any) {
      console.error('[Reprocess Error]', error);
      toast.error(`Errore durante il riprocessamento: ${error.message}`, { id: 'reprocess' });
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleRecoverMissingFulltext = async () => {
    setIsRecovering(true);
    setShowRecoverDialog(false);
    
    try {
      let totalProcessed = 0;
      let totalSuccess = 0;
      let totalFileMissing = 0;
      let totalOcrFailed = 0;
      let totalChunks = 0;
      let hasMore = true;
      let batchNumber = 1;

      toast.loading('Recupero batch 1 in corso...', { id: 'recover' });
      
      while (hasMore) {
        const { data, error } = await supabase.functions.invoke('recover-missing-fulltext', {
          body: { batchSize: 10 }
        });
        
        if (error) {
          console.error(`[Batch ${batchNumber}] Error:`, error);
          break;
        }
        
        const { summary, results } = data;
        totalProcessed += summary.total;
        totalSuccess += summary.success;
        totalFileMissing += summary.fileMissing;
        totalOcrFailed += summary.ocrFailed;
        
        // Count total chunks created
        const batchChunks = results
          .filter((r: any) => r.status === 'success')
          .reduce((sum: number, r: any) => sum + (r.chunksCreated || 0), 0);
        totalChunks += batchChunks;
        
        console.log(`[Batch ${batchNumber}] Total: ${summary.total}, Success: ${summary.success}, File Missing: ${summary.fileMissing}, OCR Failed: ${summary.ocrFailed}, Chunks: ${batchChunks}`);
        
        // Se non ci sono più documenti da processare, esci
        if (summary.total === 0) {
          hasMore = false;
        } else {
          batchNumber++;
          toast.loading(
            `Recupero batch ${batchNumber}... (✅ ${totalSuccess} recuperati, 📁 ${totalFileMissing} file mancanti, ⚠️ ${totalOcrFailed} OCR falliti, 📦 ${totalChunks} chunk)`,
            { id: 'recover' }
          );
          // Pausa di 2 secondi tra un batch e l'altro
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Build detailed message
      let message = `✅ Recupero completato! ${totalSuccess} documenti recuperati, ${totalChunks} chunk creati.`;
      if (totalFileMissing > 0) {
        message += `\n📁 ${totalFileMissing} file non trovati nello storage (marcati come validation_failed).`;
      }
      if (totalOcrFailed > 0) {
        message += `\n⚠️ ${totalOcrFailed} documenti falliti per errore OCR.`;
      }
      
      toast.success(message, { id: 'recover', duration: 15000 });
      
      setTimeout(() => {
        loadHealthMetrics();
        checkDocumentsWithoutChunks();
        checkDocumentsWithoutFulltext();
        setTableKey(prev => prev + 1);
      }, 2000);
      
    } catch (error: any) {
      console.error('[Recover Error]', error);
      toast.error(`Errore durante il recupero: ${error.message}`, { id: 'recover' });
    } finally {
      setIsRecovering(false);
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

  const handleCleanupBrokenPdfs = async () => {
    setIsCleaningBroken(true);
    toast.loading('Eliminazione PDF problematici in corso...', { id: 'cleanup-broken' });
    
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-broken-pdfs');

      if (error) {
        throw error;
      }

      if (data?.success) {
        const result = data.result;
        toast.success(
          `✅ Cleanup completato: ${result.documentsDeleted} PDF eliminati, ${result.chunksDeleted} chunks rimossi, ${result.filesDeleted} file cancellati dallo storage`,
          { id: 'cleanup-broken', duration: 6000 }
        );
        
        if (result.errors && result.errors.length > 0) {
          console.warn('[Cleanup Errors]', result.errors);
          toast.warning(`⚠️ ${result.errors.length} errori durante il cleanup (vedi console)`, { duration: 5000 });
        }
        
        // Refresh all data
        loadHealthMetrics();
        checkDocumentsWithoutChunks();
        checkDocumentsWithoutFulltext();
        setTableKey(prev => prev + 1);
      } else {
        throw new Error(data?.error || 'Errore sconosciuto durante il cleanup');
      }
      
    } catch (error: any) {
      console.error('[Cleanup Broken PDFs Error]', error);
      toast.error(`Errore durante l'eliminazione: ${error.message}`, { id: 'cleanup-broken' });
    } finally {
      setIsCleaningBroken(false);
    }
  };

  const handleRepairAndAssign = async () => {
    try {
      setIsRepairing(true);
      toast.loading('Riparazione e assegnazione in corso...', { id: 'repair' });
      
      const { data, error } = await supabase.functions.invoke('repair-and-assign-documents');
      
      if (error) throw error;
      
      setRepairReport(data);
      setShowRepairReport(true);
      toast.success("Riparazione e assegnazione completate!", { id: 'repair' });
      
      // Refresh metrics
      await loadHealthMetrics();
      await checkDocumentsWithoutChunks();
      await checkDocumentsWithoutFulltext();
      setTableKey(prev => prev + 1);
    } catch (error: any) {
      console.error('Error repairing documents:', error);
      toast.error(`Errore durante la riparazione: ${error.message}`, { id: 'repair' });
    } finally {
      setIsRepairing(false);
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
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg">
              <MoreVertical className="h-5 w-5 mr-2" />
              Manutenzione
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Operazioni di Manutenzione</DropdownMenuLabel>
            <DropdownMenuSeparator />
            
            {/* Ricategorizza Documenti GitHub */}
            <TooltipProvider>
              <DropdownMenuItem
                onClick={handleRecategorizeGitHub}
                disabled={isRecategorizing}
                className="flex items-center justify-between cursor-pointer"
              >
                <span>Ricategorizza Documenti GitHub</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">
                      Organizza i file Markdown importati da GitHub nelle cartelle corrette 
                      (Transformers, Diffusers, Datasets, PEFT, Hub) in base al repository di origine.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuItem>
            </TooltipProvider>

            <DropdownMenuSeparator />

            {/* Riprova PDF Bloccati */}
            <TooltipProvider>
              <DropdownMenuItem
                onClick={handleRetryBlocked}
                disabled={isRetrying}
                className="flex items-center justify-between cursor-pointer"
              >
                <span>Riprova PDF Bloccati</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">
                      Tenta di riprocessare i PDF che sono falliti durante l'elaborazione 
                      (status: validation_failed, processing_failed). Utile per errori temporanei.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuItem>
            </TooltipProvider>

            <DropdownMenuSeparator />

            {/* Ripara e Assegna Documenti */}
            <TooltipProvider>
              <DropdownMenuItem
                onClick={handleRepairAndAssign}
                disabled={isRepairing}
                className="flex items-center justify-between cursor-pointer"
              >
                <span>Ripara e Assegna Documenti</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">
                      Trova documenti con full_text ma senza chunks, li processa per creare i chunks,
                      e ripristina automaticamente le assegnazioni dal backup più recente.
                      Operazione completa e automatica con report dettagliato.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuItem>
            </TooltipProvider>

            {/* Backup Assegnazioni */}
            <TooltipProvider>
              <DropdownMenuItem
                onClick={handleCreateBackup}
                disabled={isCreatingBackup}
                className="flex items-center justify-between cursor-pointer"
              >
                <span>Backup Assegnazioni</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">
                      Crea un backup delle assegnazioni documento-agente. Salva quali documenti 
                      sono assegnati a quali agenti, utile prima di operazioni di manutenzione.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuItem>
            </TooltipProvider>

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Debug & Emergenza
            </DropdownMenuLabel>

            {/* Pulisci Chunks Duplicati */}
            <TooltipProvider>
              <DropdownMenuItem
                onClick={() => setShowCleanupDialog(true)}
                disabled={isCleaningChunks}
                className="flex items-center justify-between cursor-pointer"
              >
                <span>Pulisci Chunks Duplicati</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">
                      Rimuove chunk duplicati nel database. Processo in batch che consolida 
                      i chunk identici. Usare solo se si notano duplicati anomali.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuItem>
            </TooltipProvider>

            {/* Riprocessa Documenti Senza Chunk */}
            <TooltipProvider>
              <DropdownMenuItem
                onClick={() => setShowReprocessDialog(true)}
                disabled={isReprocessing || documentsWithoutChunks === 0}
                className="flex items-center justify-between cursor-pointer"
              >
                <span>Riprocessa Documenti Senza Chunk ({documentsWithoutChunks})</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">
                      Riprocessa documenti che sono in stato "ready" ma non hanno chunk associati. 
                      Processo in batch. Disabilitato se non ci sono documenti da riprocessare.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuItem>
            </TooltipProvider>

            {/* Recupera PDF Senza Full Text */}
            <TooltipProvider>
              <DropdownMenuItem
                onClick={() => setShowRecoverDialog(true)}
                disabled={isRecovering || documentsWithoutFulltext === 0}
                className="flex items-center justify-between cursor-pointer"
              >
                <span>Recupera PDF Senza Full Text ({documentsWithoutFulltext})</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">
                      Recupera documenti validati senza full_text. Verifica storage, estrae testo, 
                      crea chunk. File mancanti → validation_failed. Processo in batch da 10.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuItem>
            </TooltipProvider>

            {/* Elimina PDF Problematici */}
            <TooltipProvider>
              <DropdownMenuItem
                onClick={handleCleanupBrokenPdfs}
                disabled={isCleaningBroken}
                className="flex items-center justify-between cursor-pointer text-destructive"
              >
                <span>Elimina PDF Problematici</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">
                      Elimina definitivamente tutti i PDF che hanno errori di validazione, 
                      mancano di full_text o non sono in stato "ready_for_assignment". 
                      Include eliminazione di chunks, link e file fisici. Irreversibile.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </DropdownMenuItem>
            </TooltipProvider>

            {/* Test Aggressive Extraction (nascosto in prod) */}
            {import.meta.env.DEV && (
              <>
                <DropdownMenuSeparator />
                <TooltipProvider>
                  <DropdownMenuItem
                    onClick={handleTestAggressiveExtraction}
                    disabled={testingExtraction}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <span className="text-xs text-muted-foreground">Test Extraction</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs">
                        <p className="text-xs">
                          [DEBUG] Testa strategie di estrazione metadati aggressive. 
                          Solo per sviluppo/debugging.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </DropdownMenuItem>
                </TooltipProvider>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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

        {/* Backups Section */}
        {backups.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                💾 Backups Assegnazioni Disponibili
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {backups.slice(0, 5).map((backup) => (
                  <div
                    key={backup.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{backup.backup_name}</div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(backup.created_at).toLocaleString('it-IT')} • {backup.documents_count} documenti • {backup.assignments_count} assegnazioni
                        {backup.files_missing > 0 && ` • ⚠️ ${backup.files_missing} file mancanti`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedBackup(backup);
                          setShowBackupDialog(true);
                        }}
                      >
                        👁️ Dettagli
                      </Button>
                      {!backup.restored_at && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleRestoreBackup(backup.id)}
                          disabled={isRestoring}
                        >
                          {isRestoring ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            '🔄 Ripristina'
                          )}
                        </Button>
                      )}
                      {backup.restored_at && (
                        <div className="text-sm text-green-500 flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4" />
                          Ripristinato
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mb-6 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <DocumentPoolUpload onUploadComplete={handleUploadComplete} />
            <GitHubDocsImport onImportComplete={handleUploadComplete} />
          </div>
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

      {/* Recover Missing Fulltext Dialog */}
      <AlertDialog open={showRecoverDialog} onOpenChange={setShowRecoverDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Recupera PDF Senza Full Text
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm space-y-2">
              Questa operazione <strong>avanzata</strong> tenterà di recuperare i documenti validati che non hanno il campo full_text popolato.
              <br /><br />
              <strong>Processo di recupero:</strong>
              <br />
              1. <strong>Verifica Storage:</strong> Controlla se il PDF esiste effettivamente nei bucket
              <br />
              2. <strong>Se File Trovato:</strong> Estrae testo, salva full_text, crea chunk con embeddings
              <br />
              3. <strong>Se File Mancante:</strong> Marca il documento come "validation_failed" con motivo specifico
              <br />
              4. <strong>Se OCR Fallisce:</strong> Lascia il documento in stato attuale per debug manuale
              <br /><br />
              <strong>Feedback dettagliato:</strong> Distingue tra successi, file mancanti e errori OCR.
              <br /><br />
              <strong>Batch size:</strong> 10 documenti alla volta.
              <br /><br />
              Attualmente ci sono <strong>{documentsWithoutFulltext} documenti</strong> da recuperare. Vuoi procedere?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecoverMissingFulltext}>
              Avvia Recupero
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Backup Details Dialog */}
      <AlertDialog open={showBackupDialog} onOpenChange={setShowBackupDialog}>
        <AlertDialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Dettagli Backup</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedBackup && (
                <div className="space-y-4 mt-4">
                  <div>
                    <strong>Nome:</strong> {selectedBackup.backup_name}
                  </div>
                  <div>
                    <strong>Data:</strong> {new Date(selectedBackup.created_at).toLocaleString('it-IT')}
                  </div>
                  <div>
                    <strong>Documenti:</strong> {selectedBackup.documents_count}
                  </div>
                  <div>
                    <strong>Assegnazioni:</strong> {selectedBackup.assignments_count}
                  </div>
                  <div>
                    <strong>File trovati:</strong> <span className="text-green-500">{selectedBackup.files_found}</span>
                  </div>
                  <div>
                    <strong>File mancanti:</strong> <span className="text-red-500">{selectedBackup.files_missing}</span>
                  </div>
                  
                  {selectedBackup.restored_at && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <div className="flex items-center gap-2 text-green-500">
                        <CheckCircle2 className="h-4 w-4" />
                        <strong>Ripristinato il:</strong> {new Date(selectedBackup.restored_at).toLocaleString('it-IT')}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="text-sm text-muted-foreground mb-2">
                      Documenti nel backup:
                    </div>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {selectedBackup.assignments?.documents?.map((doc: any) => (
                        <div
                          key={doc.document_id}
                          className={`p-2 rounded border text-sm ${
                            doc.file_exists 
                              ? 'bg-green-500/10 border-green-500/20' 
                              : 'bg-red-500/10 border-red-500/20'
                          }`}
                        >
                          <div className="font-medium flex items-center gap-2">
                            {doc.file_exists ? '✅' : '❌'} {doc.file_name}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Agenti: {doc.assignments?.map((a: any) => a.agent_name).join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Chiudi</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Repair Report Dialog */}
      <AlertDialog open={showRepairReport} onOpenChange={setShowRepairReport}>
        <AlertDialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Report Riparazione e Assegnazione</AlertDialogTitle>
            <AlertDialogDescription>
              {repairReport && (
                <div className="space-y-6 mt-4 text-left">
                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <div className="text-sm text-muted-foreground">Documenti Processati</div>
                      <div className="text-2xl font-bold text-blue-500">
                        {repairReport.summary?.documentsProcessed || 0}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                      <div className="text-sm text-muted-foreground">Chunks Creati</div>
                      <div className="text-2xl font-bold text-green-500">
                        {repairReport.summary?.totalChunksCreated || 0}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <div className="text-sm text-muted-foreground">Assegnazioni Ripristinate</div>
                      <div className="text-2xl font-bold text-purple-500">
                        {repairReport.summary?.assignmentsRestored || 0}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <div className="text-sm text-muted-foreground">Sincronizzazioni</div>
                      <div className="text-2xl font-bold text-yellow-500">
                        {repairReport.summary?.syncSuccesses || 0}
                      </div>
                    </div>
                  </div>

                  {/* Processing Details */}
                  {repairReport.processing?.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">📄 Documenti Processati</h3>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {repairReport.processing.map((doc: any, idx: number) => (
                          <div 
                            key={idx}
                            className={`p-3 rounded border text-sm ${
                              doc.success 
                                ? 'bg-green-500/10 border-green-500/20' 
                                : 'bg-red-500/10 border-red-500/20'
                            }`}
                          >
                            <div className="font-medium flex items-center gap-2">
                              {doc.success ? '✅' : '❌'} {doc.fileName}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {doc.success 
                                ? `${doc.chunksCreated} chunks creati` 
                                : `Errore: ${doc.error}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Assignment Details */}
                  {repairReport.assignments && (
                    <div>
                      <h3 className="font-semibold mb-2">🔗 Assegnazioni</h3>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="p-2 rounded bg-muted">
                          <strong>Backup usato:</strong> {repairReport.assignments.backupUsed}
                        </div>
                        <div className="p-2 rounded bg-muted">
                          <strong>Assegnazioni totali:</strong> {repairReport.assignments.totalAssignments}
                        </div>
                        <div className="p-2 rounded bg-muted">
                          <strong>Ripristinate:</strong> {repairReport.assignments.restored}
                        </div>
                        <div className="p-2 rounded bg-muted">
                          <strong>Saltate:</strong> {repairReport.assignments.skipped}
                        </div>
                      </div>

                      {repairReport.assignments.details?.length > 0 && (
                        <div className="mt-3 space-y-2 max-h-40 overflow-y-auto">
                          {repairReport.assignments.details.map((detail: any, idx: number) => (
                            <div 
                              key={idx}
                              className={`p-2 rounded border text-xs ${
                                detail.success 
                                  ? 'bg-green-500/10 border-green-500/20' 
                                  : 'bg-yellow-500/10 border-yellow-500/20'
                              }`}
                            >
                              <div className="font-medium">
                                {detail.success ? '✅' : '⏭️'} {detail.documentName} → {detail.agentName}
                              </div>
                              {!detail.success && (
                                <div className="text-muted-foreground mt-1">
                                  Motivo: {detail.reason}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Errors */}
                  {repairReport.summary?.errors?.length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2 text-destructive">⚠️ Errori</h3>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {repairReport.summary.errors.map((error: string, idx: number) => (
                          <div key={idx} className="p-2 rounded bg-destructive/10 border border-destructive/20 text-xs">
                            {error}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Chiudi</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
