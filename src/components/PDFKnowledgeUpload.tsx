import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload } from "lucide-react";

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

    setUploading(true);
    
    try {
      // Step 1: Upload PDF to storage
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${agentId}/${Date.now()}.${fileExt}`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('knowledge-pdfs')
        .upload(fileName, selectedFile);

      if (uploadError) throw uploadError;

      // Step 2: Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('knowledge-pdfs')
        .getPublicUrl(fileName);

      console.log('File uploaded to:', publicUrl);

      // Step 3: Call analyze-document edge function
      const { data, error } = await supabase.functions.invoke('analyze-document', {
        body: {
          fileUrl: publicUrl,
          fileName: selectedFile.name,
          agentId: agentId,
          category: category,
          summary: summary || undefined
        }
      });

      if (error) throw error;

      console.log('Document analyzed:', data);

      toast.success(`PDF caricato con successo! ${data.chunks || 0} chunk creati.`);
      
      // Reset form
      setSelectedFile(null);
      setCategory("General");
      setSummary("");
      
      // Notify parent
      onUploadComplete();

    } catch (error: any) {
      console.error('Error uploading PDF:', error);
      toast.error(error.message || "Errore durante il caricamento del PDF");
    } finally {
      setUploading(false);
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
