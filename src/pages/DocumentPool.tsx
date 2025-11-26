import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Github } from "lucide-react";
import { DocumentPoolTable } from "@/components/DocumentPoolTable";
import { DocumentPoolUpload } from "@/components/DocumentPoolUpload";
import { GitHubDocsImport } from "@/components/GitHubDocsImport";
import { VideoTutorialUpload } from "@/components/VideoTutorialUpload";

export default function DocumentPool() {
  const navigate = useNavigate();
  const [tableKey, setTableKey] = useState(0);

  const handleUploadComplete = () => {
    setTableKey(prev => prev + 1);
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
              Carica PDF, importa da GitHub o analizza Video Tutorial
            </p>
          </div>
        </div>
      </div>

      {/* Upload/Import Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DocumentPoolUpload onUploadComplete={handleUploadComplete} />
        <GitHubDocsImport onImportComplete={handleUploadComplete} />
        <VideoTutorialUpload onUploadComplete={handleUploadComplete} />
      </div>

      {/* Single Documents Table showing ALL pool documents */}
      <DocumentPoolTable key={tableKey} />
    </div>
  );
}
