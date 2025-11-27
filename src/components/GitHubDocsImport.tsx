import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Github, Loader2, FolderGit2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface GitHubDocsImportProps {
  onImportComplete: () => void;
}

interface ImportProgress {
  repo: string;
  folder: string;
  total_files: number;
  downloaded: number;
  processed: number;
  failed: number;
  status: string;
}

export const GitHubDocsImport = ({ onImportComplete }: GitHubDocsImportProps) => {
  const [orgName, setOrgName] = useState("");
  const [orgImporting, setOrgImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress[]>([]);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<'pipeline_a' | 'pipeline_b'>('pipeline_a');

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  // Poll github_import_progress table
  const startProgressPolling = () => {
    // Clear any existing interval
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    // Poll every 2 seconds
    progressIntervalRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('github_import_progress')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(10);

        if (error) throw error;

        if (data && data.length > 0) {
          setImportProgress(data as ImportProgress[]);
        }
      } catch (error) {
        console.error('Error polling progress:', error);
      }
    }, 2000);
  };

  const stopProgressPolling = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setImportProgress([]);
  };

  const handleOrgImport = async () => {
    if (!orgName) {
      toast.error("Inserisci il nome dell'organizzazione GitHub");
      return;
    }

    setOrgImporting(true);
    startProgressPolling(); // ⭐ Start polling progress

    try {
      console.log(`🏢 Starting organization import from ${orgName}`);
      
      toast.loading(`Importazione di tutti i repository da ${orgName}...`, { id: 'org-github-import' });

      // Route to correct pipeline function
      const functionName = selectedPipeline === 'pipeline_a' 
        ? 'pipeline-a-ingest-github' 
        : 'pipeline-b-ingest-github';

      // All pipelines now use the same body format
      const requestBody = { 
        repoUrl: orgName, 
        importAllOrgRepos: true 
      };

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: requestBody
      });

      if (error) {
        console.error('❌ Edge function error:', error);
        
        // Registra alert nel database
        await supabase.from('agent_alerts').insert({
          alert_type: 'github_import_error',
          severity: 'error',
          title: 'Errore Importazione GitHub',
          message: `Errore durante l'importazione di ${orgName}: ${error.message}`
        });
        
        throw error;
      }

      console.log('✅ Organization import result:', data);

      const results = data.results;
      
      if (results.successful > 0) {
        toast.success(
          `✅ Importati ${results.successful}/${results.totalRepos} repository da ${orgName}!`,
          { id: 'org-github-import', duration: 5000 }
        );
        setOrgName("");
      } else {
        toast.warning(
          `⚠️ Nessun repository importato da ${orgName}. Potrebbero essere già presenti o non accessibili.`,
          { id: 'org-github-import' }
        );
      }

      if (results.failed > 0) {
        console.warn('⚠️ Some repos failed:', results.repos.filter((r: any) => r.status === 'failed'));
        
        // Registra alert per repository falliti
        await supabase.from('agent_alerts').insert({
          alert_type: 'github_import_warning',
          severity: 'warning',
          title: 'Repository Non Importati',
          message: `${results.failed} repository da ${orgName} non sono stati importati. Possibili timeout o problemi di connessione.`
        });
        
        toast.warning(
          `${results.failed} repository non importati. Vedi console per dettagli.`,
          { duration: 5000 }
        );
      }

      onImportComplete();

    } catch (error: any) {
      console.error('❌ Organization import error:', error);
      
      const errorMessage = error.message || 'Errore sconosciuto';
      const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('504');
      
      // Registra alert nel database
      await supabase.from('agent_alerts').insert({
        alert_type: isTimeout ? 'github_timeout' : 'github_import_error',
        severity: 'error',
        title: isTimeout ? 'Timeout Importazione GitHub' : 'Errore Importazione GitHub',
        message: isTimeout 
          ? `L'importazione di ${orgName} ha superato il tempo limite. I repository potrebbero essere troppo grandi. Prova a importare singoli repository.`
          : `Errore durante l'importazione di ${orgName}: ${errorMessage}`
      });
      
      toast.error(
        isTimeout 
          ? `⏱️ Timeout durante l'importazione. Repository troppo grandi.`
          : `Errore: ${errorMessage}`,
        { id: 'org-github-import' }
      );
    } finally {
      setOrgImporting(false);
      stopProgressPolling(); // ⭐ Stop polling when done
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          Importa da GitHub
        </CardTitle>
        <CardDescription>
          Importa automaticamente tutti i repository pubblici di un'organizzazione GitHub.
          I documenti Markdown saranno processati e indicizzati mantenendo la struttura delle cartelle originale.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
          <Label className="text-base font-semibold">Seleziona Pipeline di Elaborazione</Label>
          <RadioGroup value={selectedPipeline} onValueChange={(v) => setSelectedPipeline(v as 'pipeline_a' | 'pipeline_b')} disabled={orgImporting}>
            <div className="flex items-start space-x-3 p-3 rounded-lg border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors">
              <RadioGroupItem value="pipeline_a" id="gh-pipeline-a" className="mt-1" />
              <div className="flex-1 space-y-1">
                <Label htmlFor="gh-pipeline-a" className="cursor-pointer font-semibold flex items-center gap-2">
                  Pipeline A (LlamaParse + Small-to-Big) ⭐ Raccomandato
                </Label>
                <p className="text-sm text-muted-foreground">
                  Parsing intelligente con bypass per file di testo. Code blocks trattati come elementi atomici con summarization AI. Zero costi per file di codice/config.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg border bg-background hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="pipeline_b" id="gh-pipeline-b" className="mt-1" />
              <div className="flex-1 space-y-1">
                <Label htmlFor="gh-pipeline-b" className="cursor-pointer font-semibold">
                  Pipeline B (Landing AI)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Parsing avanzato con API Landing AI. Chunk semantici con visual grounding.
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>
        
        <div className="space-y-3">
          <Label htmlFor="orgName" className="text-base font-semibold">
            🏢 Importa Tutti i Repository di un'Organizzazione
          </Label>
          <p className="text-sm text-muted-foreground">
            Inserisci il nome dell'organizzazione GitHub (es: "lovablelabs", "facebook", "huggingface") 
            per importare automaticamente tutti i suoi repository pubblici mantenendo la struttura delle cartelle.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="orgName"
              placeholder="es: lovablelabs"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={orgImporting}
              className="flex-1"
            />
            <Button
              onClick={handleOrgImport}
              disabled={orgImporting || !orgName}
              className="whitespace-nowrap w-full sm:w-auto"
            >
              {orgImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importazione...
                </>
              ) : (
                <>
                  <FolderGit2 className="mr-2 h-4 w-4" />
                  Importa Organizzazione
                </>
              )}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            💡 <strong>Esempio:</strong> Inserendo "huggingface" importerai tutti i repository pubblici mantenendo la struttura delle cartelle originale
          </div>
        </div>

        {/* ⭐ PROGRESS DISPLAY */}
        {importProgress.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Import in corso
            </h4>
            {importProgress.map((progress) => {
              const percentage = progress.total_files > 0 
                ? Math.round((progress.downloaded / progress.total_files) * 100) 
                : 0;
              
              const statusEmoji = progress.status === 'completed' ? '✅' 
                : progress.status === 'failed' ? '❌' 
                : progress.status === 'downloading' ? '📥' 
                : '🔍';

              return (
                <div key={progress.repo} className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium flex items-center gap-2">
                      {statusEmoji} {progress.folder}
                    </span>
                    <span className="text-muted-foreground">
                      {progress.downloaded}/{progress.total_files} documenti
                    </span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                  {progress.failed > 0 && (
                    <p className="text-xs text-destructive">
                      ⚠️ {progress.failed} documenti falliti
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
