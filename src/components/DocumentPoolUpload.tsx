import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Loader2, X, AlertTriangle } from "lucide-react";
import { extractTextFromPDF } from "@/lib/pdfExtraction";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

interface DocumentPoolUploadProps {
  onUploadComplete: () => void;
}

export const DocumentPoolUpload = ({ onUploadComplete }: DocumentPoolUploadProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [duplicatesDialogOpen, setDuplicatesDialogOpen] = useState(false);
  const [duplicatesList, setDuplicatesList] = useState<File[]>([]);
  const [newFilesList, setNewFilesList] = useState<File[]>([]);

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

  const proceedWithNewFiles = async () => {
    setDuplicatesDialogOpen(false);
    toast.info(`${duplicatesList.length} file duplicato/i ignorato/i, caricamento di ${newFilesList.length} file nuovi...`);
    
    // Proceed with upload of new files only
    await performUpload(newFilesList);
    
    // Reset states
    setSelectedFiles([]);
    setDuplicatesList([]);
    setNewFilesList([]);
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      toast.error("Nessun file selezionato");
      return;
    }

    console.log('=== START SHARED POOL UPLOAD ===');
    console.log('Files:', selectedFiles.map(f => f.name));

    // Check for duplicate filenames in database
    try {
      setCheckingDuplicates(true);
      toast.info("Verifica duplicati in corso...", { duration: 2000 });
      console.log('🔍 CHECKING FOR DUPLICATES:', selectedFiles.map(f => f.name));

      const { data: existingDocs, error } = await supabase
        .from('knowledge_documents')
        .select('file_name')
        .in('file_name', selectedFiles.map(f => f.name));

      if (error) {
        throw new Error(`Errore verifica duplicati: ${error.message}`);
      }

      const existingFileNames = new Set(existingDocs?.map(d => d.file_name) || []);
      const duplicates = selectedFiles.filter(f => existingFileNames.has(f.name));
      const newFiles = selectedFiles.filter(f => !existingFileNames.has(f.name));

      if (duplicates.length > 0) {
        console.log('⚠️ DUPLICATES FOUND:', duplicates.map(f => f.name));
        console.log('✓ NEW FILES TO UPLOAD:', newFiles.map(f => f.name));
        setDuplicatesList(duplicates);
        setNewFilesList(newFiles);
        setDuplicatesDialogOpen(true);
        return;
      }

      console.log('✓ No duplicates found - proceeding with upload');
    } catch (error: any) {
      console.error('❌ Error checking duplicates:', error);
      toast.error(`Errore durante la verifica: ${error.message}`);
      return;
    } finally {
      setCheckingDuplicates(false);
    }

    // No duplicates, proceed with upload
    await performUpload(selectedFiles);
    setSelectedFiles([]);
  };

  const performUpload = async (filesToUpload: File[]) => {
    setUploading(true);
    setProgress(0);
    let successCount = 0;
    let errorCount = 0;
    const totalFiles = filesToUpload.length;
    
    try {
      for (let fileIndex = 0; fileIndex < filesToUpload.length; fileIndex++) {
        const file = filesToUpload[fileIndex];
        setCurrentFile(file.name);
        
        try {
          console.log(`\n=== [${fileIndex + 1}/${totalFiles}] STARTING: ${file.name} ===`);
          
          // Step 1: Extract text from PDF
          setProgress((fileIndex / totalFiles) * 100 + 10);
          const text = await extractTextFromPDF(file);
          console.log(`✓ Extracted ${text.length} characters from ${file.name}`);
          
          // Se l'estrazione nativa fallisce (PDF scannerizzato), 
          // l'edge function farà OCR automaticamente
          if (!text || text.length < 10) {
            console.warn(`⚠️ Estrazione nativa fallita per ${file.name}, verrà usato OCR`);
          }

          // Step 1.5: Convert PDF file to base64 for storage (using FileReader to avoid stack overflow)
          const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              // Remove the "data:application/pdf;base64," prefix
              resolve(result.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          // Step 2: Upload to shared pool (all processing happens in edge function)
          setProgress((fileIndex / totalFiles) * 100 + 30);
          
          console.log(`Uploading "${file.name}" to shared pool (with PDF file)...`);
          
          const { data, error } = await supabase.functions.invoke('upload-pdf-to-shared-pool', {
            body: {
              text: text,
              fileName: file.name,
              fileSize: file.size,
              fileData: base64Data
            }
          });

          console.log('Edge function response:', { data, error });

          if (error) {
            console.error('Edge function error:', error);
            throw new Error(`Upload fallito: ${error.message}`);
          }
          
          if (!data?.success) {
            console.error('Edge function returned failure:', data);
            throw new Error(`Upload fallito: ${data?.error || 'Errore sconosciuto'}`);
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
          disabled={selectedFiles.length === 0 || uploading || checkingDuplicates}
          className="w-full"
        >
          {checkingDuplicates ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifica in corso...
            </>
          ) : uploading ? (
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

      <AlertDialog open={duplicatesDialogOpen} onOpenChange={setDuplicatesDialogOpen}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Riepilogo Upload
            </AlertDialogTitle>
            <AlertDialogDescription>
              Alcuni file sono già presenti nel pool e verranno ignorati. Vuoi procedere con il caricamento dei file nuovi?
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-4 my-4">
            {newFilesList.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-green-600 mb-2 flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  File nuovi da caricare ({newFilesList.length})
                </h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {newFilesList.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-950/20 rounded text-sm">
                      <span className="truncate flex-1">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)}MB
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {duplicatesList.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-yellow-600 mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  File duplicati (verranno ignorati) ({duplicatesList.length})
                </h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {duplicatesList.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded text-sm">
                      <span className="truncate flex-1">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)}MB
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDuplicatesDialogOpen(false);
              setDuplicatesList([]);
              setNewFilesList([]);
            }}>
              Annulla
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={proceedWithNewFiles}
              disabled={newFilesList.length === 0}
            >
              Continua con {newFilesList.length} file nuov{newFilesList.length === 1 ? 'o' : 'i'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};