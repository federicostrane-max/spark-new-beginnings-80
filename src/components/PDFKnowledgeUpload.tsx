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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("General");
  const [summary, setSummary] = useState<string>("");
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        toast.error("Per favore seleziona un file PDF");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Il file deve essere minore di 10MB");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Seleziona un file PDF");
      return;
    }

    console.log('=== START PDF UPLOAD (NEW SYSTEM) ===');
    console.log('File:', selectedFile.name, selectedFile.size, 'bytes');
    console.log('AgentId:', agentId);
    console.log('Category:', category);

    setUploading(true);
    
    try {
      // Step 1: Extract text from PDF in browser
      console.log('Step 1: Extracting text from PDF in browser...');
      const text = await extractTextFromPDF(selectedFile);
      
      console.log('Extracted text length:', text.length);
      
      if (!text || text.length < 10) {
        throw new Error('PDF vuoto o non leggibile');
      }

      // Step 2: Chunk text in browser
      console.log('Step 2: Chunking text...');
      const chunks = chunkText(text, 1000, 200);
      
      console.log('Created chunks:', chunks.length);

      // Step 3: Send chunks to edge function for embedding generation
      console.log('Step 3: Sending chunks to edge function...');
      const { data, error } = await supabase.functions.invoke('process-chunks', {
        body: {
          chunks: chunks,
          agentId: agentId,
          fileName: selectedFile.name,
          category: category,
          summary: summary || undefined
        }
      });

      console.log('Edge function response:', { data, error });

      if (error) {
        console.error('Edge function error:', error);
        throw error;
      }

      console.log('Document processed successfully:', data);

      toast.success(`PDF caricato con successo! ${data.chunks || 0} chunk creati.`);
      
      // Reset form
      setSelectedFile(null);
      setCategory("General");
      setSummary("");
      
      // Notify parent
      onUploadComplete();

    } catch (error: any) {
      console.error('=== ERROR IN PDF UPLOAD ===', error);
      toast.error(error.message || "Errore durante il caricamento del PDF");
    } finally {
      setUploading(false);
      console.log('=== END PDF UPLOAD ===');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="pdf-file">Seleziona PDF</Label>
        <div className="mt-2">
          <Input
            id="pdf-file"
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            disabled={uploading}
          />
          {selectedFile && (
            <p className="text-sm text-muted-foreground mt-2">
              File selezionato: {selectedFile.name}
            </p>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="category">Categoria</Label>
        <Select value={category} onValueChange={setCategory} disabled={uploading}>
          <SelectTrigger id="category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="General">Generale</SelectItem>
            <SelectItem value="Technical">Tecnico</SelectItem>
            <SelectItem value="Marketing">Marketing</SelectItem>
            <SelectItem value="Legal">Legale</SelectItem>
            <SelectItem value="Financial">Finanziario</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="summary">Sommario (Opzionale)</Label>
        <Textarea
          id="summary"
          placeholder="Breve descrizione del documento..."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          disabled={uploading}
          className="h-20"
        />
      </div>

      <Button
        onClick={handleUpload}
        disabled={!selectedFile || uploading}
        className="w-full"
      >
        {uploading ? (
          <>Caricamento in corso...</>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            Carica PDF
          </>
        )}
      </Button>
    </div>
  );
};
