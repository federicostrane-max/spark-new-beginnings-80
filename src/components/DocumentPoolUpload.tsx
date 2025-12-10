import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Loader2, X, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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

// Threshold for direct storage upload (5MB) - files larger than this bypass base64 encoding
const DIRECT_STORAGE_THRESHOLD = 5 * 1024 * 1024;

export const DocumentPoolUpload = ({ onUploadComplete }: DocumentPoolUploadProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [duplicatesDialogOpen, setDuplicatesDialogOpen] = useState(false);
  const [duplicatesList, setDuplicatesList] = useState<File[]>([]);
  const [newFilesList, setNewFilesList] = useState<File[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<'pipeline_a' | 'pipeline_a_hybrid' | 'pipeline_b'>('pipeline_a');
  const [inputKey, setInputKey] = useState(0);

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
    setInputKey(prev => prev + 1);
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

      // Check all pipelines: A, A-Hybrid, B
      // Exclude failed documents to allow re-upload
      const [pipelineAResult, pipelineAHybridResult, pipelineBResult] = await Promise.all([
        supabase
          .from('pipeline_a_documents')
          .select('file_name')
          .in('file_name', selectedFiles.map(f => f.name))
          .neq('status', 'failed'),
        supabase
          .from('pipeline_a_hybrid_documents')
          .select('file_name')
          .in('file_name', selectedFiles.map(f => f.name))
          .neq('status', 'failed'),
        supabase
          .from('pipeline_b_documents')
          .select('file_name')
          .in('file_name', selectedFiles.map(f => f.name))
          .neq('status', 'failed')
      ]);

      if (pipelineAResult.error) {
        throw new Error(`Errore verifica duplicati (Pipeline A): ${pipelineAResult.error.message}`);
      }
      if (pipelineAHybridResult.error) {
        throw new Error(`Errore verifica duplicati (Pipeline A-Hybrid): ${pipelineAHybridResult.error.message}`);
      }
      if (pipelineBResult.error) {
        throw new Error(`Errore verifica duplicati (Pipeline B): ${pipelineBResult.error.message}`);
      }

      const existingFileNames = new Set([
        ...(pipelineAResult.data?.map(d => d.file_name) || []),
        ...(pipelineAHybridResult.data?.map(d => d.file_name) || []),
        ...(pipelineBResult.data?.map(d => d.file_name) || [])
      ]);
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
    setInputKey(prev => prev + 1);
  };

  const performUpload = async (filesToUpload: File[]) => {
    setUploading(true);
    setProgress(0);
    let successCount = 0;
    let errorCount = 0;
    const totalFiles = filesToUpload.length;
    const errors: string[] = [];
    
    try {
      for (let fileIndex = 0; fileIndex < filesToUpload.length; fileIndex++) {
        const file = filesToUpload[fileIndex];
        setCurrentFile(file.name);
        
        try {
          console.log(`\n=== [${fileIndex + 1}/${totalFiles}] STARTING: ${file.name} ===`);
          console.log(`File size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
          
          const pipelineName = selectedPipeline === 'pipeline_a' ? 'Pipeline A' : selectedPipeline === 'pipeline_a_hybrid' ? 'Pipeline A-Hybrid' : 'Pipeline B';
          const edgeFunctionName = selectedPipeline === 'pipeline_a' ? 'pipeline-a-ingest-pdf' : selectedPipeline === 'pipeline_a_hybrid' ? 'pipeline-a-hybrid-ingest-pdf' : 'pipeline-b-ingest-pdf';
          
          console.log(`Uploading "${file.name}" to ${pipelineName}...`);
          
          let data, error;
          
          // Large files: upload directly to Storage to avoid memory limits
          if (file.size > DIRECT_STORAGE_THRESHOLD) {
            console.log(`⚡ Large file (${(file.size / 1024 / 1024).toFixed(1)}MB) - using direct storage upload`);
            setProgress((fileIndex / totalFiles) * 100 + 10);
            
            // Step 1: Upload directly to Supabase Storage
            const storagePath = `direct-uploads/${crypto.randomUUID()}/${file.name}`;
            const { error: storageError } = await supabase.storage
              .from('pipeline-a-uploads')
              .upload(storagePath, file, {
                contentType: 'application/pdf',
                upsert: false
              });
            
            if (storageError) {
              throw new Error(`Storage upload failed: ${storageError.message}`);
            }
            
            console.log(`✓ File uploaded to storage: ${storagePath}`);
            setProgress((fileIndex / totalFiles) * 100 + 50);
            
            // Step 2: Get public URL
            const { data: urlData } = supabase.storage
              .from('pipeline-a-uploads')
              .getPublicUrl(storagePath);
            
            console.log(`✓ Storage URL obtained: ${urlData.publicUrl}`);
            
            // Step 3: Invoke edge function with storageUrl (no base64!)
            const result = await supabase.functions.invoke(edgeFunctionName, {
              body: { 
                fileName: file.name,
                storageUrl: urlData.publicUrl,
                fileSize: file.size
              },
            });
            
            data = result.data;
            error = result.error;
            
          } else {
            // Small files: use existing base64 method
            console.log(`📄 Small file (${(file.size / 1024 / 1024).toFixed(1)}MB) - using base64 upload`);
            setProgress((fileIndex / totalFiles) * 100 + 30);
            
            const arrayBuffer = await file.arrayBuffer();
            const base64 = btoa(
              new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            
            const result = await supabase.functions.invoke(edgeFunctionName, {
              body: { 
                fileName: file.name,
                fileData: base64,
                fileSize: file.size
              },
            });
            
            data = result.data;
            error = result.error;
          }

          if (error) {
            console.error(`Edge function error:`, error);
            throw new Error(`Upload fallito: ${error.message}`);
          }

          if (!data?.success) {
            throw new Error(`Upload fallito: ${data?.error || 'Errore sconosciuto'}`);
          }
          
          console.log(`✓ ${file.name} caricato - documento ID: ${data.documentId}`);
          toast.success(`${file.name} caricato`);
          
          successCount++;
          setProgress(Math.min(99, ((successCount + errorCount) / totalFiles) * 100));

        } catch (error: any) {
          console.error(`✗ Error with ${file.name}:`, error);
          const errorMsg = error.message || 'Errore sconosciuto';
          errors.push(`${file.name}: ${errorMsg}`);
          toast.error(`Errore: ${file.name}`, { description: errorMsg });
          errorCount++;
          setProgress(Math.min(99, ((successCount + errorCount) / totalFiles) * 100));
          
          // Continue with next file even on error
          console.log(`Continuing with next file... (${errorCount} errors so far)`);
        }
      }

      // Summary
      const summaryMsg = `Caricamento completato: ${successCount} riusciti, ${errorCount} falliti`;
      console.log(`\n=== ${summaryMsg} ===`);
      
      if (errorCount > 0) {
        console.error('Errori dettagliati:', errors);
        toast.warning(summaryMsg, { 
          description: `File con errori: ${errors.slice(0, 3).map(e => e.split(':')[0]).join(', ')}${errors.length > 3 ? '...' : ''}`,
          duration: 8000 
        });
      } else if (successCount > 0) {
        toast.success(summaryMsg);
      }
      
      // Reset form
      setSelectedFiles([]);
      setCurrentFile("");
      setProgress(0);
      setInputKey(prev => prev + 1);
      
      // Reload documents
      setTimeout(() => {
        onUploadComplete();
      }, 1000);

    } catch (error: any) {
      console.error('=== FATAL ERROR IN UPLOAD ===', error);
      toast.error('Errore critico durante il caricamento', { description: error.message });
    } finally {
      setUploading(false);
      setCurrentFile("");
      setProgress(0);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Carica Nuovi Documenti</CardTitle>
        <CardDescription>
          Carica PDF nel pool condiviso. Scegli quale pipeline utilizzare per l'elaborazione.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
          <Label className="text-base font-semibold">Seleziona Pipeline di Elaborazione</Label>
          <RadioGroup value={selectedPipeline} onValueChange={(v) => setSelectedPipeline(v as 'pipeline_a' | 'pipeline_a_hybrid' | 'pipeline_b')} disabled={uploading}>
            <div className="flex items-start space-x-3 p-3 rounded-lg border bg-background hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="pipeline_a" id="pipeline-a" className="mt-1" />
              <div className="flex-1 space-y-1">
                <Label htmlFor="pipeline-a" className="cursor-pointer font-semibold">
                  Pipeline A (LlamaParse + Recursive Retrieval) ⭐
                </Label>
                <p className="text-sm text-muted-foreground">
                  Parsing intelligente con LlamaParse + Recursive Retrieval. Preserva tabelle atomiche, genera summary LLM, swap automatico. Zero information loss.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg border bg-background hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="pipeline_a_hybrid" id="pipeline-a-hybrid" className="mt-1" />
              <div className="flex-1 space-y-1">
                <Label htmlFor="pipeline-a-hybrid" className="cursor-pointer font-semibold">
                  Pipeline A-Hybrid (LlamaParse JSON + Document Reconstruction)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Parsing avanzato con LlamaParse JSON + Document Reconstructor. Reading order gerarchico (page → Y zones → X position), image descriptions da Vision API, ricostruzione Super-Document lineare.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg border bg-background hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="pipeline_b" id="pipeline-b" className="mt-1" />
              <div className="flex-1 space-y-1">
                <Label htmlFor="pipeline-b" className="cursor-pointer font-semibold">
                  Pipeline B (Landing AI)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Parsing avanzato con API Landing AI. Chunk semantici con visual grounding. Ideale per documenti complessi.
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>
        
        <div>
          <Label htmlFor="pdf-file">Seleziona PDF (multipli, max 50MB)</Label>
          <div className="mt-2">
            <Input
              key={inputKey}
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
                    <div className="flex items-center gap-2">
                      {file.size > DIRECT_STORAGE_THRESHOLD && (
                        <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                          Direct Upload
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)}MB
                      </span>
                    </div>
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