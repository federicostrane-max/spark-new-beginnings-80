import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { extractTextFromPDF } from "@/lib/pdfExtraction";
import { chunkText } from "@/lib/textChunking";

interface PDFKnowledgeUploadProps {
  agentId: string;
  onUploadComplete: () => void;
}

export const PDFKnowledgeUpload = ({ agentId, onUploadComplete }: PDFKnowledgeUploadProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles: File[] = [];
    
    for (const file of files) {
      if (file.type !== "application/pdf") {
        toast.error(`${file.name} non è un PDF`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} supera i 10MB`);
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
    let successCount = 0;
    let errorCount = 0;
    
    try {
      for (const file of selectedFiles) {
        try {
          console.log(`Processing ${file.name}...`);
          
          // Step 1: Extract text from PDF in browser
          const text = await extractTextFromPDF(file);
          
          if (!text || text.length < 10) {
            throw new Error('PDF vuoto o non leggibile');
          }

          // Step 2: Chunk text in browser
          const chunks = chunkText(text, 1000, 200);
          
          console.log(`Created ${chunks.length} chunks for ${file.name}`);

          // Step 3: Send chunks to edge function for embedding generation
          const { data, error } = await supabase.functions.invoke('process-chunks', {
            body: {
              chunks: chunks,
              agentId: agentId,
              fileName: file.name,
              category: "General",
              summary: undefined
            }
          });

          if (error) {
            console.error(`Error processing ${file.name}:`, error);
            errorCount++;
            toast.error(`Errore con ${file.name}`);
          } else {
            console.log(`${file.name} processed successfully`);
            successCount++;
          }

        } catch (error: any) {
          console.error(`Error with ${file.name}:`, error);
          errorCount++;
          toast.error(`Errore con ${file.name}: ${error.message}`);
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount} PDF caricati con successo!`);
      }
      
      // Reset form
      setSelectedFiles([]);
      
      // Notify parent
      onUploadComplete();

    } catch (error: any) {
      console.error('=== ERROR IN PDF UPLOAD ===', error);
      toast.error(error.message || "Errore durante il caricamento");
    } finally {
      setUploading(false);
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
          {selectedFiles.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium">File selezionati ({selectedFiles.length}):</p>
              {selectedFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between bg-muted p-2 rounded">
                  <span className="text-sm truncate flex-1">{file.name}</span>
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


      <Button
        onClick={handleUpload}
        disabled={selectedFiles.length === 0 || uploading}
        className="w-full"
      >
        {uploading ? (
          <>Caricamento in corso...</>
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
