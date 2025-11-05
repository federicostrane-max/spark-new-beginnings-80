import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History, RotateCcw, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";

interface PromptVersion {
  id: string;
  system_prompt: string;
  created_at: string;
  version_number: number;
}

interface PromptHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string | null;
  agentName: string;
  currentPrompt: string;
  onRestore: (prompt: string) => void;
}

export const PromptHistoryDialog = ({
  open,
  onOpenChange,
  agentId,
  agentName,
  currentPrompt,
  onRestore
}: PromptHistoryDialogProps) => {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  useEffect(() => {
    if (open && agentId) {
      loadHistory();
    }
  }, [open, agentId]);

  const loadHistory = async () => {
    if (!agentId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_prompt_history")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setVersions(data || []);
    } catch (error) {
      console.error("Error loading prompt history:", error);
      toast.error("Errore nel caricamento della cronologia");
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = (prompt: string) => {
    onRestore(prompt);
    toast.success("Prompt ripristinato! Ricorda di salvare le modifiche.");
    onOpenChange(false);
  };

  const truncatePrompt = (prompt: string, maxLength: number = 150) => {
    if (prompt.length <= maxLength) return prompt;
    return prompt.substring(0, maxLength) + "...";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Cronologia Prompt - {agentName}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[60vh] pr-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Nessuna versione precedente disponibile</p>
              <p className="text-sm mt-1">
                Le modifiche al prompt verranno salvate automaticamente qui
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Current version card */}
              <Card className="border-primary/50 bg-primary/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>Versione Corrente</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-normal">
                      In uso
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {truncatePrompt(currentPrompt)}
                  </p>
                  {selectedVersion === 'current' && (
                    <div className="mt-3 p-3 bg-background rounded border">
                      <p className="text-sm whitespace-pre-wrap">{currentPrompt}</p>
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedVersion(selectedVersion === 'current' ? null : 'current')}
                    >
                      {selectedVersion === 'current' ? 'Nascondi' : 'Visualizza completo'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Previous versions */}
              {versions.map((version, index) => (
                <Card key={version.id} className="hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4" />
                        <span>Versione #{versions.length - index}</span>
                      </div>
                      <span className="text-xs text-muted-foreground font-normal">
                        {formatDistanceToNow(new Date(version.created_at), {
                          addSuffix: true,
                          locale: it
                        })}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {truncatePrompt(version.system_prompt)}
                    </p>
                    {selectedVersion === version.id && (
                      <div className="mt-3 p-3 bg-background rounded border">
                        <p className="text-sm whitespace-pre-wrap">{version.system_prompt}</p>
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedVersion(selectedVersion === version.id ? null : version.id)}
                      >
                        {selectedVersion === version.id ? 'Nascondi' : 'Visualizza completo'}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleRestore(version.system_prompt)}
                        className="gap-2"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Ripristina
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
