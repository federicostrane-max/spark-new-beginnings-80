import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";
import { extractTextFromPDF } from "@/lib/pdfExtraction";
import { chunkText } from "@/lib/textChunking";

interface PDFKnowledgeUploadProps {
  agentId: string;
  onUploadComplete: () => void;
}

export const PDFKnowledgeUpload = ({ agentId, onUploadComplete }: PDFKnowledgeUploadProps) => {
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
      toast.error("Seleziona almeno un file PDF");
      return;
    }

    console.log('=== START MULTI-PDF UPLOAD ===');
    console.log('Files:', selectedFiles.map(f => f.name));
    console.log('AgentId:', agentId);

    setUploading(true);
    setProgress(0);
    let successCount = 0;
    let errorCount = 0;
    const totalFiles = selectedFiles.length;
    const errors: string[] = [];
    
    try {
      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
        const file = selectedFiles[fileIndex];
        setCurrentFile(file.name);
        
        try {
          console.log(`[${fileIndex + 1}/${totalFiles}] Processing ${file.name}...`);
          console.log(`File size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
          
          // Step 1: Extract text from PDF in browser
          setProgress((fileIndex / totalFiles) * 100 + 10);
          const text = await extractTextFromPDF(file);
          
          console.log(`Extracted ${text.length} characters from ${file.name}`);
          
          if (!text || text.length < 10) {
            throw new Error('PDF vuoto o non leggibile');
          }

          // Step 2: Chunk text in browser
          setProgress((fileIndex / totalFiles) * 100 + 20);
          const chunks = chunkText(text, 1000, 200);
          
          console.log(`Created ${chunks.length} chunks for ${file.name}`);

          // Step 3: Send chunks in batches (parallel processing on edge function)
          const BATCH_SIZE = 50; // Batch size increased thanks to parallel processing
          const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
          let processedChunks = 0;
          
          for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const start = batchIndex * BATCH_SIZE;
            const end = Math.min(start + BATCH_SIZE, chunks.length);
            const batchChunks = chunks.slice(start, end);
            
            console.log(`Processing batch ${batchIndex + 1}/${totalBatches} for ${file.name} (${batchChunks.length} chunks)`);
            
            // Calculate progress correctly: each file gets equal portion of 100%
            const fileProgressStart = (fileIndex / totalFiles) * 100;
            const fileProgressRange = (1 / totalFiles) * 100;
            const batchProgressWithinFile = (batchIndex / totalBatches) * fileProgressRange;
            const totalProgress = Math.min(99, fileProgressStart + batchProgressWithinFile);
            setProgress(totalProgress);
            
            let retries = 0;
            const MAX_RETRIES = 2;
            let batchSuccess = false;
            
            while (!batchSuccess && retries <= MAX_RETRIES) {
              try {
                const { data, error } = await supabase.functions.invoke('process-chunks', {
                  body: {
                    chunks: batchChunks,
                    agentId: agentId,
                    fileName: file.name,
                    category: "General"
                  }
                });

                if (error) {
                  throw error;
                }
                
                if (!data?.success) {
                  throw new Error('Risposta imprevista dal server');
                }
                
                batchSuccess = true;
                processedChunks += batchChunks.length;
                console.log(`Batch ${batchIndex + 1}/${totalBatches} completed. Total processed: ${processedChunks}/${chunks.length}`);
                
              } catch (batchError: any) {
                retries++;
                console.error(`Error in batch ${batchIndex + 1}, retry ${retries}/${MAX_RETRIES}:`, batchError);
                
                if (retries > MAX_RETRIES) {
                  throw new Error(`Batch ${batchIndex + 1} fallito dopo ${MAX_RETRIES} tentativi: ${batchError.message}`);
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * retries));
              }
            }
          }
          
          console.log(`✓ ${file.name} processed successfully - ${processedChunks} chunks created in ${totalBatches} batches`);
          successCount++;
          // Update progress based on successfully completed files
          setProgress(Math.min(99, ((successCount + errorCount) / totalFiles) * 100));

        } catch (error: any) {
          console.error(`✗ Error with ${file.name}:`, error);
          errorCount++;
          errors.push(`${file.name}: ${error.message}`);
          // Update progress even on error
          setProgress(Math.min(99, ((successCount + errorCount) / totalFiles) * 100));
        }
      }

      if (successCount > 0) {
        toast.success(`✓ ${successCount} PDF caricati con successo!`);
      }
      if (errorCount > 0) {
        console.error('Upload errors:', errors);
        toast.error(`✗ ${errorCount} PDF hanno generato errori. Controlla la console per i dettagli.`);
      }
      
      // Reset form
      setSelectedFiles([]);
      setCurrentFile("");
      setProgress(0);
      
      // Notify parent
      onUploadComplete();

    } catch (error: any) {
      console.error('=== ERROR IN PDF UPLOAD ===', error);
      toast.error(error.message || "Errore durante il caricamento");
    } finally {
      setUploading(false);
      setCurrentFile("");
      setProgress(0);
      console.log(`=== END UPLOAD === Success: ${successCount}, Errors: ${errorCount}`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="pdf-file">Seleziona PDF (multipli)</Label>
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
                <div key={index} className="flex items-center justify-between gap-2 bg-muted p-2 rounded min-w-0">
                  <span className="text-sm break-all flex-1 min-w-0">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(index)}
                    disabled={uploading}
                  >
                    ✕
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
            <p className="text-sm text-muted-foreground break-all">
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
    </div>
  );
};
