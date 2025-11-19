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
import { Slider } from "@/components/ui/slider";

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
  const [maxFiles, setMaxFiles] = useState([100]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const handleRepoChange = (value: string) => {
    setSelectedRepo(value);
    const repo = HUGGINGFACE_REPOS.find(r => r.value === value);
    if (repo) {
      setPathFilter(repo.path);
    }
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

      const { data, error } = await supabase.functions.invoke('fetch-github-docs', {
        body: {
          repo: selectedRepo,
          path: pathFilter,
          maxFiles: maxFiles[0],
          filePattern: "*.md"
        }
      });

      if (error) throw error;

      console.log('✅ GitHub import result:', data);

      const { results } = data;
      
      if (results.saved > 0) {
        toast.success(
          `${results.saved} documenti importati da GitHub! Elaborazione in corso...`,
          { id: 'github-import', duration: 5000 }
        );
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

      // Close dialog and refresh
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
      let totalFailed = 0;

      for (const repo of HUGGINGFACE_REPOS) {
        console.log(`📥 Importing ${repo.label}...`);
        
        const { data, error } = await supabase.functions.invoke('fetch-github-docs', {
          body: {
            repo: repo.value,
            path: repo.path,
            maxFiles: 150, // More per repo for batch
            filePattern: "*.md"
          }
        });

        if (error) {
          console.error(`❌ Failed to import ${repo.label}:`, error);
          totalFailed++;
          continue;
        }

        totalSaved += data.results.saved;
        console.log(`✅ ${repo.label}: ${data.results.saved} docs`);
        
        // Small delay between repos
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      toast.success(
        `Batch import completato! ${totalSaved} documenti importati da ${HUGGINGFACE_REPOS.length} repository`,
        { id: 'batch-import', duration: 6000 }
      );

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

          {/* Max Files */}
          <div className="space-y-2">
            <Label>Max Files: {maxFiles[0]}</Label>
            <Slider
              value={maxFiles}
              onValueChange={setMaxFiles}
              min={10}
              max={500}
              step={10}
              disabled={importing}
            />
            <p className="text-xs text-muted-foreground">
              Numero massimo di file da importare
            </p>
          </div>

          {/* Progress */}
          {importing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Importazione in corso...</span>
              </div>
              <Progress value={100} className="animate-pulse" />
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
