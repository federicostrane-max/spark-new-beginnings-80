import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Github, Loader2, FolderGit2 } from "lucide-react";

interface GitHubDocsImportProps {
  onImportComplete: () => void;
}

export const GitHubDocsImport = ({ onImportComplete }: GitHubDocsImportProps) => {
  const [orgName, setOrgName] = useState("");
  const [orgImporting, setOrgImporting] = useState(false);

  const handleOrgImport = async () => {
    if (!orgName) {
      toast.error("Inserisci il nome dell'organizzazione GitHub");
      return;
    }

    setOrgImporting(true);

    try {
      console.log(`🏢 Starting organization import from ${orgName}`);
      
      toast.loading(`Importazione di tutti i repository da ${orgName}...`, { id: 'org-github-import' });

      const { data, error } = await supabase.functions.invoke('import-github-markdown', {
        body: {
          repo: orgName,
          path: "",
          maxFiles: 999999,
          filePattern: "*.md",
          importAllOrgRepos: true
        }
      });

      if (error) throw error;

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
        toast.warning(
          `${results.failed} repository non importati. Vedi console per dettagli.`,
          { duration: 5000 }
        );
      }

      onImportComplete();

    } catch (error: any) {
      console.error('❌ Organization import error:', error);
      toast.error(
        `Errore durante l'import dell'organizzazione: ${error.message}`,
        { id: 'org-github-import' }
      );
    } finally {
      setOrgImporting(false);
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
      </CardContent>
    </Card>
  );
};
