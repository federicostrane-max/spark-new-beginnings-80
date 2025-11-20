import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Github, Loader2, Download } from "lucide-react";
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
}

const HUGGINGFACE_REPOS = [
  { value: "huggingface/hub-docs", label: "Hub Documentation", path: "docs/hub/en" },
  { value: "huggingface/transformers", label: "Transformers", path: "docs/source/en" },
  { value: "huggingface/datasets", label: "Datasets", path: "docs/source" },
  { value: "huggingface/diffusers", label: "Diffusers", path: "docs/source/en" },
  { value: "huggingface/peft", label: "PEFT", path: "docs/source" },
];

export const GitHubDocsImport = ({ onImportComplete }: GitHubDocsImportProps) => {
  const [open, setOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [monitoring, setMonitoring] = useState(false);
  const [processingStats, setProcessingStats] = useState({ total: 0, ready: 0, processing: 0 });

  const handleRepoChange = (value: string) => {
    setSelectedRepo(value);
    const repo = HUGGINGFACE_REPOS.find(r => r.value === value);
    if (repo) {
      setPathFilter(repo.path);
    }
  };

  const monitorProcessing = async (searchQuery: string) => {
    setMonitoring(true);
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
          toast.success(`Elaborazione completata: ${ready} documenti pronti`, { duration: 5000 });
        }
      }
    }, 5000);

    setTimeout(() => {
      clearInterval(pollInterval);
      setMonitoring(false);
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
    setImporting(true);
    
    try {
      toast.loading('Importazione batch Hugging Face docs...', { id: 'batch-import' });

      let totalSaved = 0;
      let totalSkipped = 0;
      let totalFailed = 0;

      for (const repo of HUGGINGFACE_REPOS) {
        try {
          console.log(`📥 Importing ${repo.label}...`);
          
          toast.loading(`Importazione ${repo.label}...`, { id: `batch-${repo.value}` });

          const { data, error } = await supabase.functions.invoke('import-github-markdown', {
            body: {
              repo: repo.value,
              path: repo.path,
              maxFiles: 999999,
              filePattern: "*.md"
            }
          });

          if (error) throw error;

          const results = data.results || data;
          totalSaved += results.saved;
          totalSkipped += results.skipped;
          totalFailed += results.failed;

          toast.success(
            `${repo.label}: ${results.saved} importati, ${results.skipped} già presenti`,
            { id: `batch-${repo.value}` }
          );

          console.log(`✅ ${repo.label}: ${results.saved} saved, ${results.skipped} skipped`);
          
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error: any) {
          console.error(`❌ Failed to import ${repo.label}:`, error);
          totalFailed++;
          toast.error(`Errore ${repo.label}: ${error.message}`, { id: `batch-${repo.value}` });
        }
      }

      toast.success(
        `Batch completato: ${totalSaved} importati, ${totalSkipped} già presenti, ${totalFailed} errori`,
        { id: 'batch-import', duration: 5000 }
      );

      HUGGINGFACE_REPOS.forEach(repo => {
        monitorProcessing(`GitHub: ${repo.value}`);
      });

      setOpen(false);
      onImportComplete();

    } catch (error: any) {
      console.error('❌ Batch import error:', error);
      toast.error(`Errore batch import: ${error.message}`, { id: 'batch-import' });
    } finally {
      setImporting(false);
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
            <Label htmlFor="path">Path Filter</Label>
            <Input
              id="path"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              placeholder="es: docs/hub/en"
              disabled={importing}
            />
            <p className="text-xs text-muted-foreground">
              Filtra per directory specifica (opzionale)
            </p>
          </div>

          {/* Info - Download Completo */}
          <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground border border-border">
            <p className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              <strong>Download completo senza limiti:</strong>
            </p>
            <p className="mt-1 ml-6">
              L'import è ottimizzato per scaricare repository complete senza timeout. 
              I documenti vengono elaborati in background dopo l'import.
            </p>
          </div>

          {/* Progress */}
          {importing && (
            <div className="space-y-2">
              <Progress value={33} className="w-full" />
              <p className="text-sm text-muted-foreground">Import in corso...</p>
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
              disabled={!selectedRepo || importing}
              className="w-full"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importazione...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Importa Documenti
                </>
              )}
            </Button>

            <Button
              variant="secondary"
              onClick={handleBatchImport}
              disabled={importing}
              className="w-full"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Batch Import...
                </>
              ) : (
                <>
                  <Github className="mr-2 h-4 w-4" />
                  Importa Tutti i Repo HF (~500 docs)
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
