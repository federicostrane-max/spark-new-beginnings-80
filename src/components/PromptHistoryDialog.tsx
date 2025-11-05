import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RotateCcw, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";

interface PromptHistoryItem {
  id: string;
  system_prompt: string;
  created_at: string;
  version_number: number;
}

interface PromptHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  onRestore: (prompt: string) => void;
}

export const PromptHistoryDialog = ({ open, onOpenChange, agentId, onRestore }: PromptHistoryDialogProps) => {
  const [history, setHistory] = useState<PromptHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (open && agentId) {
      loadHistory();
    }
  }, [open, agentId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_prompt_history")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error("Error loading prompt history:", error);
      toast.error("Errore nel caricamento della cronologia");
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (item: PromptHistoryItem) => {
    setRestoring(item.id);
    try {
      onRestore(item.system_prompt);
      toast.success(`Prompt ripristinato (v${item.version_number})`);
      onOpenChange(false);
    } catch (error) {
      console.error("Error restoring prompt:", error);
      toast.error("Errore nel ripristino del prompt");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Cronologia System Prompt
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Nessuna versione precedente trovata
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-4">
              {history.map((item, index) => (
                <div
                  key={item.id}
                  className="border rounded-lg p-4 space-y-3 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-sm">
                          Versione {item.version_number}
                        </span>
                        {index === 0 && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                            Corrente
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(item.created_at), {
                            addSuffix: true,
                            locale: it,
                          })}
                        </span>
                      </div>
                      <div className="bg-muted/50 rounded p-3 text-sm font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                        {item.system_prompt}
                      </div>
                    </div>
                    {index !== 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestore(item)}
                        disabled={restoring === item.id}
                      >
                        {restoring === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Ripristina
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};
