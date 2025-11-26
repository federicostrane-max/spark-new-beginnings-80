import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Video, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface VideoDocumentInfo {
  document_id: string;
  file_name: string;
  file_path: string;
  storage_bucket: string;
  processing_metadata?: {
    director_prompt_preview?: string;
    model_used?: string;
  };
}

interface DeepDiveVideoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  videoDocuments: VideoDocumentInfo[];
  suggestedQuery: string;
  agentId?: string;
}

export const DeepDiveVideoDialog = ({
  isOpen,
  onClose,
  videoDocuments,
  suggestedQuery,
  agentId
}: DeepDiveVideoDialogProps) => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>(
    videoDocuments[0]?.document_id || ''
  );
  const [searchQuery, setSearchQuery] = useState(suggestedQuery);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDeepDive = async () => {
    if (!selectedDocumentId || !searchQuery.trim() || !agentId) {
      toast.error("Seleziona un video e specifica cosa cercare");
      return;
    }

    setIsProcessing(true);

    try {
      const { data, error } = await supabase.functions.invoke('deep-dive-video', {
        body: {
          documentId: selectedDocumentId,
          searchQuery: searchQuery.trim(),
          agentId
        }
      });

      if (error) {
        throw error;
      }

      toast.success(
        "🎬 Video analizzato con successo!",
        {
          description: "Ripeti la domanda per vedere i nuovi risultati nella knowledge base.",
          duration: 6000
        }
      );

      onClose();
    } catch (error) {
      console.error('Deep dive error:', error);
      toast.error(
        "Errore durante l'analisi del video",
        {
          description: error instanceof Error ? error.message : "Errore sconosciuto"
        }
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5 text-primary" />
            Cerca nel Video
          </DialogTitle>
          <DialogDescription>
            Estrai informazioni specifiche dal video analizzandolo nuovamente con un prompt mirato.
            Il risultato verrà aggiunto alla knowledge base.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Video Selection */}
          {videoDocuments.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="video-select">Video da analizzare</Label>
              <Select value={selectedDocumentId} onValueChange={setSelectedDocumentId}>
                <SelectTrigger id="video-select">
                  <SelectValue placeholder="Seleziona un video" />
                </SelectTrigger>
                <SelectContent>
                  {videoDocuments.map((doc) => (
                    <SelectItem key={doc.document_id} value={doc.document_id}>
                      <div className="flex items-center gap-2">
                        <Video className="h-4 w-4" />
                        <span className="truncate max-w-[400px]">{doc.file_name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {videoDocuments.length === 1 && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Video className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium truncate">
                {videoDocuments[0].file_name}
              </span>
            </div>
          )}

          {/* Search Query Input */}
          <div className="space-y-2">
            <Label htmlFor="search-query">Cosa cercare nel video</Label>
            <Textarea
              id="search-query"
              placeholder="Es: timestamp quando il prezzo tocca la SMA 50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Sii specifico: l'AI analizzerà il video cercando <strong>solo</strong> questa informazione.
            </p>
          </div>

          {/* Info Alert */}
          <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <Sparkles className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-700 dark:text-blue-400">
              <strong>Come funziona:</strong> Il video verrà analizzato nuovamente con un prompt
              chirurgico mirato. Il risultato sarà <strong>aggiunto</strong> (non sostituito) alla
              knowledge base, arricchendo le informazioni disponibili per l'agente.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>
            Annulla
          </Button>
          <Button onClick={handleDeepDive} disabled={isProcessing || !searchQuery.trim()}>
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Analisi in corso...
              </>
            ) : (
              <>
                <Video className="h-4 w-4 mr-2" />
                Cerca
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
