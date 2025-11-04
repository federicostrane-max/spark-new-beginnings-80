import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { FileText, Calendar, CheckCircle2, Hash, Tag, Gauge, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

interface KnowledgeDocument {
  id: string;
  file_name: string;
  validation_status: string;
  validation_reason: string;
  processing_status: string;
  ai_summary: string;
  text_length: number;
  created_at: string;
  agent_names: string[];
  agents_count: number;
  keywords?: string[];
  topics?: string[];
  complexity_level?: string;
}

interface DocumentDetailsDialogProps {
  document: KnowledgeDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DocumentDetailsDialog = ({
  document,
  open,
  onOpenChange,
}: DocumentDetailsDialogProps) => {
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  if (!document) return null;

  const handleRegenerateSummary = async () => {
    if (!document.id) return;

    try {
      setIsRegenerating(true);
      toast.info("Rigenerazione summary in corso...");

      const { error } = await supabase.functions.invoke("process-document", {
        body: {
          documentId: document.id,
        },
      });

      if (error) throw error;

      toast.success("Summary rigenerato con successo!");
      onOpenChange(false);
      
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      console.error("Error regenerating summary:", error);
      toast.error("Errore nella rigenerazione del summary");
    } finally {
      setIsRegenerating(false);
    }
  };

  const getComplexityColor = (level?: string) => {
    switch (level?.toLowerCase()) {
      case "low":
        return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
      case "medium":
        return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20";
      case "high":
        return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getComplexityLabel = (level?: string) => {
    switch (level?.toLowerCase()) {
      case "low":
        return "Basso";
      case "medium":
        return "Medio";
      case "high":
        return "Alto";
      default:
        return "Non specificato";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <FileText className="h-5 w-5 text-primary" />
                Dettagli Documento
              </DialogTitle>
              <DialogDescription className="text-base font-medium pt-2">
                {document.file_name}
              </DialogDescription>
            </div>
            {document.validation_status === "validated" && !document.ai_summary && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRegenerateSummary}
                disabled={isRegenerating}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
                Rigenera
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* AI Summary Section */}
          {document.ai_summary && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Riepilogo AI
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed bg-muted/50 p-4 rounded-lg">
                {document.ai_summary}
              </p>
            </div>
          )}

          <Separator />

          {/* Keywords Section */}
          {document.keywords && document.keywords.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Hash className="h-4 w-4" />
                Keywords
              </h3>
              <div className="flex flex-wrap gap-2">
                {document.keywords.map((keyword, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {keyword}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Topics Section */}
          {document.topics && document.topics.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Topics
              </h3>
              <div className="flex flex-wrap gap-2">
                {document.topics.map((topic, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs">
                    {topic}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Complexity Level Section */}
          {document.complexity_level && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Gauge className="h-4 w-4" />
                Livello di Complessità
              </h3>
              <Badge className={getComplexityColor(document.complexity_level)}>
                {getComplexityLabel(document.complexity_level)}
              </Badge>
            </div>
          )}

          <Separator />

          {/* Technical Metadata Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Metadati Tecnici</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <span className="text-muted-foreground">Lunghezza testo:</span>
                <p className="font-medium">
                  {document.text_length?.toLocaleString() || "N/A"} caratteri
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground">Status validazione:</span>
                <div className="flex items-center gap-2">
                  {document.validation_status === "validated" && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                  <p className="font-medium capitalize">
                    {document.validation_status === "validated" ? "Validato" : document.validation_status}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground">Agenti assegnati:</span>
                <p className="font-medium">{document.agents_count}</p>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Creato:
                </span>
                <p className="font-medium">
                  {formatDistanceToNow(new Date(document.created_at), {
                    addSuffix: true,
                    locale: it,
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Assigned Agents Section */}
          {document.agent_names && document.agent_names.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Agenti Assegnati</h3>
                <div className="flex flex-wrap gap-2">
                  {document.agent_names.map((name, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
