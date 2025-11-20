import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { DocumentPoolTable } from "@/components/DocumentPoolTable";
import { DocumentPoolUpload } from "@/components/DocumentPoolUpload";
import { GitHubDocsImport } from "@/components/GitHubDocsImport";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function DocumentPool() {
  const navigate = useNavigate();
  const [tableKey, setTableKey] = useState(0);
  const [isRecategorizing, setIsRecategorizing] = useState(false);

  const handleUploadComplete = () => {
    setTableKey(prev => prev + 1);
  };

  const handleRecategorizeGitHub = async () => {
    try {
      setIsRecategorizing(true);
      toast.loading('Ricategorizzazione documenti GitHub in corso...', { id: 'recategorize' });

      const { data, error } = await supabase.rpc('recategorize_github_documents');

      if (error) throw error;

      toast.success(`${data} documenti ricategorizzati con successo`, { 
        id: 'recategorize',
        duration: 5000 
      });

      setTableKey(prev => prev + 1);
    } catch (error: any) {
      console.error('[Recategorize Error]', error);
      toast.error(`Errore: ${error.message}`, { id: 'recategorize' });
    } finally {
      setIsRecategorizing(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Indietro
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Pool Documenti Condivisi</h1>
            <p className="text-muted-foreground mt-1">
              Carica PDF e importa documentazione da GitHub
            </p>
          </div>
        </div>
      </div>

      {/* Upload & Import Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DocumentPoolUpload onUploadComplete={handleUploadComplete} />
        <GitHubDocsImport 
          onImportComplete={handleUploadComplete}
          onRecategorize={handleRecategorizeGitHub}
          isRecategorizing={isRecategorizing}
        />
      </div>

      {/* Documents Table */}
      <DocumentPoolTable key={tableKey} />
    </div>
  );
}
