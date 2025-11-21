import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Github, Loader2, Download, FolderGit2, FolderTree } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


interface GitHubDocsImportProps {
  onImportComplete: () => void;
  onRecategorize: () => void;
  isRecategorizing: boolean;
}

// ⭐ Path vuoto = import COMPLETO del repository (con filtri intelligenti)
const HUGGINGFACE_REPOS = [
  { value: "huggingface/hub-docs", label: "Hub Documentation", path: "" },
  { value: "huggingface/transformers", label: "Transformers", path: "" },
  { value: "huggingface/datasets", label: "Datasets", path: "" },
  { value: "huggingface/diffusers", label: "Diffusers", path: "" },
  { value: "huggingface/peft", label: "PEFT", path: "" },
];

export const GitHubDocsImport = ({ onImportComplete, onRecategorize, isRecategorizing }: GitHubDocsImportProps) => {
  const [open, setOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [monitoring, setMonitoring] = useState(false);
  const [processingStats, setProcessingStats] = useState({ total: 0, ready: 0, processing: 0 });
  const [batchImporting, setBatchImporting] = useState(false);
  const [hasActiveImport, setHasActiveImport] = useState(false);
  const [importProgress, setImportProgress] = useState<Map<string, {
    total: number;
    downloaded: number;
    processed: number;
    failed: number;
    status: string;
  }>>(new Map());

  const handleRepoChange = (value: string) => {
    setSelectedRepo(value);
    const repo = HUGGINGFACE_REPOS.find(r => r.value === value);
    if (repo) {
      setPathFilter(repo.path);
    }
  };

  const monitorProcessing = async (searchQuery: string) => {
    setMonitoring(true);
    setHasActiveImport(true);
    
    const pollInterval = setInterval(async () => {
      const { data } = await supabase
        .from('knowledge_documents')
        .select('processing_status')
        .like('search_query', `%${searchQuery}%`);

      if (data) {
        const total = data.length;
        const ready = data.filter(d => d.processing_status === 'ready_for_assignment').length;
        const processing = data.filter(d => d.processing_status === 'pending_processing' || d.processing_status === 'processing').length;
        
        setProcessingStats({ total, ready, processing });
        
        if (processing === 0 && total > 0) {
          clearInterval(pollInterval);
          setMonitoring(false);
          setHasActiveImport(false);
          toast.success(`Elaborazione completata: ${ready} documenti pronti`, { duration: 5000 });
        }
      }
    }, 5000);

    setTimeout(() => {
      clearInterval(pollInterval);
      setMonitoring(false);
      setHasActiveImport(false);
    }, 300000);
  };

  const handleImport = async () => {
    if (!selectedRepo) {
      toast.error("Seleziona un repository");
      return;
    }

    setImporting(true);
    setProgress({ current: 0, total: 0 });

    try {
      console.log(`📥 Starting GitHub import from ${selectedRepo}`);
      
      toast.loading(`Importazione da ${selectedRepo}...`, { id: 'github-import' });

      const { data, error } = await supabase.functions.invoke('import-github-markdown', {
        body: {
          repo: selectedRepo,
          path: pathFilter,
          maxFiles: 999999, // Nessun limite - scarica TUTTO
          filePattern: "*.md"
        }
      });

      if (error) throw error;

      console.log('✅ GitHub import result:', data);

      const results = data.results || data;
      
      if (results.saved > 0) {
        toast.success(
          `${results.saved} documenti importati da GitHub! Elaborazione in corso...`,
          { id: 'github-import', duration: 5000 }
        );
        
        monitorProcessing(`GitHub: ${selectedRepo}`);
      } else {
        toast.info(
          'Nessun nuovo documento trovato (potrebbero essere già presenti)',
          { id: 'github-import' }
        );
      }

      if (results.failed > 0) {
        console.warn('⚠️ Some files failed:', results.errors);
        toast.warning(
          `${results.failed} file non importati. Vedi console per dettagli.`,
          { duration: 5000 }
        );
      }

      setOpen(false);
      onImportComplete();

    } catch (error: any) {
      console.error('❌ GitHub import error:', error);
      toast.error(
        `Errore durante l'import: ${error.message}`,
        { id: 'github-import' }
      );
    } finally {
      setImporting(false);
    }
  };

  const handleBatchImport = async () => {
    setBatchImporting(true);
    setImportProgress(new Map());
    
    try {
      toast.loading('Importazione batch Hugging Face docs...', { id: 'batch-import' });

      let totalSaved = 0;
      let totalSkipped = 0;
      let totalFailed = 0;

      // Start polling for progress
      const reposToTrack = HUGGINGFACE_REPOS.map(r => r.value);
      const pollInterval = setInterval(async () => {
        const { data } = await supabase
          .from('github_import_progress')
          .select('*')
          .in('repo', reposToTrack)
          .order('started_at', { ascending: false });
        
        if (data) {
          const progressMap = new Map();
          data.forEach(item => {
            progressMap.set(item.repo, {
              total: item.total_files,
              downloaded: item.downloaded,
              processed: item.processed,
              failed: item.failed,
              status: item.status
            });
          });
          setImportProgress(progressMap);
        }
      }, 2000);

      // FASE 1: Import TUTTI i repos SENZA processing
      for (const repo of HUGGINGFACE_REPOS) {
        try {
          console.log(`📥 Importing ${repo.label}...`);
          
          toast.loading(`Importazione ${repo.label}...`, { id: `batch-${repo.value}` });

          const { data, error } = await supabase.functions.invoke('import-github-markdown', {
            body: {
              repo: repo.value,
              path: repo.path,
              maxFiles: 999999,
              filePattern: "*.md",
              skipProcessing: true  // ⭐ NON avviare batch processing automatico
            }
          });

          if (error) {
            console.error(`❌ Error importing ${repo.label}:`, error);
            throw error;
          }

          const results = data.results || data;
          totalSaved += results.saved;
          totalSkipped += results.skipped;
          totalFailed += results.failed;

          toast.success(
            `${repo.label}: ${results.saved} importati, ${results.skipped} già presenti`,
            { id: `batch-${repo.value}` }
          );

          console.log(`✅ ${repo.label}: ${results.saved} saved, ${results.skipped} skipped`);
          
          // Pausa più lunga tra repos per evitare rate limit GitHub
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (error: any) {
          console.error(`❌ Failed to import ${repo.label}:`, error);
          totalFailed++;
          toast.error(`Errore ${repo.label}: ${error.message}`, { id: `batch-${repo.value}` });
          // ⭐ Continua con il prossimo repo anche in caso di errore
        }
      }

      // FASE 2: Processa TUTTI i documenti in una volta
      if (totalSaved > 0) {
        console.log(`\n🚀 Starting batch processing for all ${totalSaved} imported documents...`);
        toast.loading('Processing documenti importati...', { id: 'batch-processing' });
        
        try {
          const { error: processError } = await supabase.functions.invoke('process-github-batch', {
            body: { batchSize: 100 }  // Processa tutti i documenti in batches di 100
          });
          
          if (processError) throw processError;
          
          toast.success('Processing avviato con successo', { id: 'batch-processing' });
        } catch (processError: any) {
          console.error('❌ Processing error:', processError);
          toast.error(`Errore processing: ${processError.message}`, { id: 'batch-processing' });
        }
      }

      toast.success(
        `Batch completato: ${totalSaved} importati, ${totalSkipped} già presenti, ${totalFailed} errori`,
        { id: 'batch-import', duration: 5000 }
      );

      // Wait a bit for final progress updates
      await new Promise(resolve => setTimeout(resolve, 3000));
      clearInterval(pollInterval);

      setOpen(false);
      onImportComplete();

    } catch (error: any) {
      console.error('❌ Batch import error:', error);
      toast.error(`Errore batch import: ${error.message}`, { id: 'batch-import' });
    } finally {
      setBatchImporting(false);
      setImportProgress(new Map());
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Github className="h-4 w-4" />
          Import da GitHub
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Importa Documentazione da GitHub
          </DialogTitle>
          <DialogDescription>
            Scarica automaticamente documentazione Markdown da repository GitHub.
            I documenti saranno processati e indicizzati per la ricerca semantica.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Repository Selection */}
          <div className="space-y-2">
            <Label htmlFor="repo">Repository Hugging Face</Label>
            <Select value={selectedRepo} onValueChange={handleRepoChange}>
              <SelectTrigger id="repo">
                <SelectValue placeholder="Seleziona repository..." />
              </SelectTrigger>
              <SelectContent>
                {HUGGINGFACE_REPOS.map(repo => (
                  <SelectItem key={repo.value} value={repo.value}>
                    {repo.label} ({repo.value})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Path Filter */}
          <div className="space-y-2">
            <Label htmlFor="path">Path Filter (opzionale)</Label>
            <Input
              id="path"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              placeholder="Vuoto = intero repository, oppure es: docs/source"
              disabled={importing}
            />
            <p className="text-xs text-muted-foreground">
              💡 <strong>Lascia vuoto per import completo automatico</strong> del repository.
              Il sistema escluderà automaticamente cartelle non rilevanti (.github, tests, examples, ecc.)
            </p>
          </div>

          {/* Info - Import Automatico Completo */}
          <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground border border-border">
            <p className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              <strong>✨ Import automatico completo:</strong>
            </p>
            <ul className="mt-2 ml-6 space-y-1 text-xs">
              <li>• <strong>Path vuoto</strong>: scarica TUTTI i markdown del repository</li>
              <li>• <strong>Filtri intelligenti</strong>: esclude automaticamente .github, tests, examples, ecc.</li>
              <li>• <strong>Nessuna configurazione manuale</strong>: funziona con qualsiasi struttura di repository</li>
              <li>• <strong>Elaborazione background</strong>: i documenti vengono processati dopo l'import</li>
            </ul>
          </div>

          {/* Progress */}
          {importing && (
            <div className="space-y-2">
              <Progress value={33} className="w-full" />
              <p className="text-sm text-muted-foreground">Import in corso...</p>
            </div>
          )}

          {/* Import Progress Monitor */}
          {importProgress.size > 0 && (
            <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
              <h4 className="text-sm font-semibold">📊 Stato Import per Repository:</h4>
              {HUGGINGFACE_REPOS.map(repo => {
                const progress = importProgress.get(repo.value);
                if (!progress) return null;
                
                return (
                  <div key={repo.value} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{repo.label}</span>
                      <span className="text-muted-foreground font-mono">
                        {progress.status === 'discovering' && '🔍 Scansione repo...'}
                        {progress.status === 'downloading' && 
                          `📥 ${progress.downloaded}/${progress.total} scaricati`}
                        {progress.status === 'processing' && 
                          `⚙️ ${progress.processed}/${progress.total} elaborati`}
                        {progress.status === 'completed' && 
                          `✓ ${progress.total}/${progress.total} completati`}
                        {progress.failed > 0 && ` (${progress.failed} ❌)`}
                      </span>
                    </div>
                    <Progress 
                      value={
                        progress.status === 'completed' 
                          ? 100 
                          : progress.status === 'processing'
                          ? 50 + ((progress.processed / progress.total) * 50)
                          : ((progress.downloaded / progress.total) * 50)
                      }
                      className="h-1.5"
                    />
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Processing Monitor */}
          {monitoring && processingStats.total > 0 && (
            <div className="space-y-2 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Elaborazione in corso...</span>
                <span className="text-sm text-muted-foreground">
                  {processingStats.ready} / {processingStats.total} pronti
                </span>
              </div>
              <Progress 
                value={(processingStats.ready / processingStats.total) * 100} 
                className="w-full" 
              />
              <p className="text-xs text-muted-foreground">
                {processingStats.processing} documenti in elaborazione
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-4">
            <Button
              onClick={handleImport}
              disabled={!selectedRepo || importing || hasActiveImport}
              className="w-full"
            >
              {importing || hasActiveImport ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {importing ? 'Importazione...' : 'Elaborazione in corso...'}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Importa Documenti
                </>
              )}
            </Button>

            <Button
              onClick={handleBatchImport}
              disabled={importing || batchImporting || hasActiveImport}
              className="w-full gap-2"
            >
              {batchImporting || hasActiveImport ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {batchImporting ? `Importazione in corso (${progress.current}/${progress.total})` : 'Elaborazione in corso...'}
                </>
              ) : (
                <>
                  <FolderGit2 className="h-4 w-4" />
                  Importa Tutti Repos Huggingface
                </>
              )}
            </Button>

            <Button
              onClick={onRecategorize}
              disabled={isRecategorizing}
              variant="outline"
              className="w-full gap-2"
            >
              {isRecategorizing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ricategorizzazione...
                </>
              ) : (
                <>
                  <FolderTree className="h-4 w-4" />
                  Riorganizza Documenti GitHub
                </>
              )}
            </Button>
          </div>

          {/* Info */}
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              <strong>💡 Vantaggi GitHub API:</strong>
              <br />
              • Documenti in Markdown puro (alta qualità)
              <br />
              • Gratuito e veloce (fino a 5000 req/ora)
              <br />
              • Change detection automatico
              <br />
              • Zero costi di scraping
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
