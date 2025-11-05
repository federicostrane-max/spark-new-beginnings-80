import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RotateCcw, Clock, Info } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
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
        ) : history.length === 1 ? (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    Questa è la prima versione del prompt
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Le versioni precedenti appariranno qui dopo che modifichi e salvi il system prompt. 
                    Potrai quindi ripristinare qualsiasi versione precedente.
                  </p>
                </div>
              </div>
            </div>
            
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {history.map((item, index) => (
                  <div
                    key={item.id}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-sm">
                            Versione {item.version_number}
                          </span>
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                            Corrente
                          </span>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-muted-foreground cursor-help">
                                  {formatDistanceToNow(new Date(item.created_at), {
                                    addSuffix: true,
                                    locale: it,
                                  })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{format(new Date(item.created_at), "PPpp", { locale: it })}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <div className="bg-muted/50 rounded p-3 text-sm font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                          {item.system_prompt}
                        </div>
                        <div className="text-xs text-muted-foreground italic mt-2 flex items-center gap-1">
                          <Info className="h-3 w-3" />
                          Nessuna versione precedente disponibile
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
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
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-muted-foreground cursor-help">
                                {formatDistanceToNow(new Date(item.created_at), {
                                  addSuffix: true,
                                  locale: it,
                                })}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{format(new Date(item.created_at), "PPpp", { locale: it })}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
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
