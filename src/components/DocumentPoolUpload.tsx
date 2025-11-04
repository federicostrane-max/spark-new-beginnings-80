import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Loader2, X } from "lucide-react";
import { extractTextFromPDF } from "@/lib/pdfExtraction";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DocumentPoolUploadProps {
  onUploadComplete: () => void;
}

export const DocumentPoolUpload = ({ onUploadComplete }: DocumentPoolUploadProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [progress, setProgress] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles: File[] = [];
    
    for (const file of files) {
      if (file.type !== "application/pdf") {
        toast.error(`${file.name} non è un PDF`);
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`${file.name} supera i 50MB`);
        continue;
      }
      validFiles.push(file);
    }
    
    setSelectedFiles(prev => [...prev, ...validFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error("Nessun file selezionato");
      return;
    }

    console.log('=== START SHARED POOL UPLOAD ===');
    console.log('Files:', selectedFiles.map(f => f.name));

    setUploading(true);
    setProgress(0);
    let successCount = 0;
    let errorCount = 0;
    const totalFiles = selectedFiles.length;
    
    try {
      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
        const file = selectedFiles[fileIndex];
        setCurrentFile(file.name);
        
        try {
          console.log(`\n=== [${fileIndex + 1}/${totalFiles}] STARTING: ${file.name} ===`);
          
          // Step 1: Extract text from PDF
          setProgress((fileIndex / totalFiles) * 100 + 10);
          const text = await extractTextFromPDF(file);
          console.log(`✓ Extracted ${text.length} characters from ${file.name}`);
          
          if (!text || text.length < 10) {
            throw new Error('PDF vuoto o non leggibile');
          }

          // Step 2: Upload to shared pool (all processing happens in edge function)
          setProgress((fileIndex / totalFiles) * 100 + 30);
          
          console.log(`Uploading "${file.name}" to shared pool...`);
          
          const { data, error } = await supabase.functions.invoke('upload-pdf-to-shared-pool', {
            body: {
              text: text,
              fileName: file.name,
              fileSize: file.size
            }
          });

          if (error) {
            throw new Error(`Upload failed: ${error.message}`);
          }
          
          if (!data?.success) {
            throw new Error(`Upload failed: ${data?.error || 'Unknown error'}`);
          }
          
          console.log(`✓ ${file.name} uploaded - ${data.chunksProcessed} chunks created, document ID: ${data.documentId}`);
          toast.success(`${file.name} caricato con successo`);
          
          successCount++;
          setProgress(Math.min(99, ((successCount + errorCount) / totalFiles) * 100));

        } catch (error: any) {
          console.error(`✗ Error with ${file.name}:`, error);
          toast.error(`Errore con ${file.name}: ${error.message}`);
          errorCount++;
          setProgress(Math.min(99, ((successCount + errorCount) / totalFiles) * 100));
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} documento${successCount > 1 ? 'i' : ''} caricato${successCount > 1 ? 'i' : ''} con successo`);
      }
      
      // Reset form
      setSelectedFiles([]);
      setCurrentFile("");
      setProgress(0);
      
      // Reload documents
      setTimeout(() => {
        onUploadComplete();
      }, 1000);

    } catch (error: any) {
      console.error('=== ERROR IN SHARED POOL UPLOAD ===', error);
      toast.error('Errore durante il caricamento');
    } finally {
      setUploading(false);
      setCurrentFile("");
      setProgress(0);
      console.log(`=== END UPLOAD === Success: ${successCount}, Errors: ${errorCount}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Carica Nuovi Documenti</CardTitle>
        <CardDescription>
          Carica PDF nel pool condiviso. L'AI analizzerà automaticamente i contenuti.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="pdf-file">Seleziona PDF (multipli, max 50MB)</Label>
          <div className="mt-2">
            <Input
              id="pdf-file"
              type="file"
              accept=".pdf"
              multiple
              onChange={handleFileChange}
              disabled={uploading}
            />
            {selectedFiles.length > 0 && !uploading && (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium">File selezionati ({selectedFiles.length}):</p>
                {selectedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between gap-2 bg-muted p-2 rounded">
                    <span className="text-sm truncate flex-1">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)}MB
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      disabled={uploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {uploading && (
          <div className="space-y-3 p-4 bg-muted rounded-lg">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Caricamento in corso...</span>
            </div>
            {currentFile && (
              <p className="text-sm text-muted-foreground truncate">
                Elaborando: {currentFile}
              </p>
            )}
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-right">
              {Math.round(progress)}%
            </p>
          </div>
        )}

        <Button
          onClick={handleUpload}
          disabled={selectedFiles.length === 0 || uploading}
          className="w-full"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Caricamento in corso...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Carica {selectedFiles.length > 0 ? `${selectedFiles.length} PDF` : 'PDF'}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};