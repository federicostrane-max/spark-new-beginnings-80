import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Github, ChevronRight, Upload, CheckCircle, Cog, FolderCheck } from "lucide-react";
import { DocumentPoolTable } from "@/components/DocumentPoolTable";
import { DocumentPoolUpload } from "@/components/DocumentPoolUpload";
import { GitHubDocsImport } from "@/components/GitHubDocsImport";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
              Gestisci documenti da PDF e GitHub con due pipeline separate
            </p>
          </div>
        </div>
      </div>

      {/* Tabs for PDF and GitHub Pipelines */}
      <Tabs defaultValue="github" className="w-full">
        <TabsList className="grid w-full max-w-md mx-auto grid-cols-2">
          <TabsTrigger value="pdf" className="gap-2">
            <FileText className="h-4 w-4" />
            Pipeline PDF
          </TabsTrigger>
          <TabsTrigger value="github" className="gap-2">
            <Github className="h-4 w-4" />
            Pipeline GitHub
          </TabsTrigger>
        </TabsList>

        {/* PDF Pipeline Tab */}
        <TabsContent value="pdf" className="space-y-6">
          {/* PDF Upload Card */}
          <div className="grid grid-cols-1 gap-6">
            <DocumentPoolUpload onUploadComplete={handleUploadComplete} />
          </div>

          {/* PDF Workflow Visual */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Workflow PDF</CardTitle>
              <CardDescription className="text-xs">
                I documenti PDF seguono questo processo di validazione e processing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Upload className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Upload</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Validation</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <Cog className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Processing</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <FolderCheck className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Ready</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* PDF Documents Table */}
          <DocumentPoolTable key={`pdf-${tableKey}`} sourceType="pdf" />
        </TabsContent>

        {/* GitHub Pipeline Tab */}
        <TabsContent value="github" className="space-y-6">
          {/* GitHub Import Card */}
          <div className="grid grid-cols-1 gap-6">
            <GitHubDocsImport onImportComplete={handleUploadComplete} />
          </div>

          {/* GitHub Workflow Visual */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Workflow GitHub</CardTitle>
              <CardDescription className="text-xs">
                I documenti GitHub vengono importati direttamente e processati (no validazione)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Github className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Import</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <Cog className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Processing</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <FolderCheck className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Ready</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* GitHub Documents Table */}
          <DocumentPoolTable key={`github-${tableKey}`} sourceType="github" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
