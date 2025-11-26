import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Video, Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface VideoTutorialUploadProps {
  onUploadComplete: () => void;
}

export const VideoTutorialUpload = ({ onUploadComplete }: VideoTutorialUploadProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [inputKey, setInputKey] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validazione: solo MP4, max 500MB
    if (!file.type.includes('video/mp4')) {
      toast.error("Solo file .mp4 sono supportati");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error("Il file supera i 500MB");
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setProgress(10);
    setStatus("Caricamento video...");

    try {
      // Converti in base64
      const arrayBuffer = await selectedFile.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => 
          data + String.fromCharCode(byte), ''
        )
      );

      setProgress(30);
      setStatus("Invio a Gemini per analisi...");

      // Chiama edge function
      const { data, error } = await supabase.functions.invoke('pipeline-a-ingest-video', {
        body: { 
          fileName: selectedFile.name,
          fileData: base64,
          fileSize: selectedFile.size
        },
      });

      if (error || !data?.success) {
        throw new Error(error?.message || 'Errore nell\'elaborazione video');
      }

      setProgress(100);
      setStatus("Video elaborato con successo!");
      toast.success(`${selectedFile.name} elaborato e indicizzato`);

      setSelectedFile(null);
      setUploading(false);
      setInputKey(prev => prev + 1); // Reset input
      onUploadComplete();
    } catch (err) {
      console.error('[Video Upload] Error:', err);
      toast.error(err instanceof Error ? err.message : "Errore nell'elaborazione video");
      setUploading(false);
    }
  };

  return (
    <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Video className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Importa Video Tutorial</CardTitle>
            <CardDescription className="text-sm">
              Carica video .mp4. Gemini 1.5 Pro estrarrà trascrizione e contenuto visuale.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* File input */}
        <Input
          key={inputKey}
          type="file"
          accept="video/mp4"
          onChange={handleFileChange}
          disabled={uploading}
          className="cursor-pointer"
        />

        {/* Selected file info */}
        {selectedFile && !uploading && (
          <Alert>
            <Video className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span className="font-medium">{selectedFile.name}</span>
              <span className="text-sm text-muted-foreground">
                {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            </AlertDescription>
          </Alert>
        )}

        {/* Progress */}
        {uploading && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground text-center">{status}</p>
          </div>
        )}

        {/* Upload button */}
        <Button
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
          className="w-full"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Elaborazione in corso...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Elabora Video Tutorial
            </>
          )}
        </Button>

        {/* Info box */}
        <Alert className="bg-muted/50 border-muted">
          <AlertDescription className="text-xs space-y-1">
            <p className="font-medium">ℹ️ Come funziona</p>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              <li>Gemini 1.5 Pro trascriverà tutto il parlato</li>
              <li>Tabelle e grafici saranno convertiti in Markdown</li>
              <li>Il risultato entrerà nella Pipeline A standard</li>
              <li>Potrai chiedere all'agente: "Cosa mostra il grafico al minuto 5?"</li>
            </ul>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
