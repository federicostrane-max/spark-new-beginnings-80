import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Link as LinkIcon, Search, Clock } from "lucide-react";

interface Agent {
  id: string;
  name: string;
}

interface BulkAssignDocumentDialogProps {
  documentIds?: string[];
  folderName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

export const BulkAssignDocumentDialog = ({
  documentIds,
  folderName,
  open,
  onOpenChange,
  onAssigned,
}: BulkAssignDocumentDialogProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const [documentCount, setDocumentCount] = useState(0);
  const [validatedCount, setValidatedCount] = useState(0);
  const [processingCount, setProcessingCount] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string>("");

  const countDocuments = async () => {
    console.log('[BulkAssign] countDocuments called with:', {
      documentIds: documentIds?.length,
      folderName,
      documentIdsPreview: documentIds?.slice(0, 5)
    });

    try {
      if (folderName) {
        toast.error('Funzionalità cartelle temporaneamente disabilitata');
        return;
      } else if (documentIds && documentIds.length > 0) {
        // Manual selection: check Pipeline A, B, C
        const [
          pipelineATotal, pipelineBTotal, pipelineCTotal,
          pipelineAValid, pipelineBValid, pipelineCValid,
          pipelineAProcessing, pipelineBProcessing, pipelineCProcessing
        ] = await Promise.all([
          // Pipeline A total
          supabase
            .from("pipeline_a_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds),
          // Pipeline B total
          supabase
            .from("pipeline_b_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds),
          // Pipeline C total
          supabase
            .from("pipeline_c_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds),
          // Pipeline A valid
          supabase
            .from("pipeline_a_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .eq("status", "ready"),
          // Pipeline B valid
          supabase
            .from("pipeline_b_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .eq("status", "ready"),
          // Pipeline C valid
          supabase
            .from("pipeline_c_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .eq("status", "ready"),
          // Pipeline A processing
          supabase
            .from("pipeline_a_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .neq("status", "ready")
            .neq("status", "failed"),
          // Pipeline B processing
          supabase
            .from("pipeline_b_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .neq("status", "ready")
            .neq("status", "failed"),
          // Pipeline C processing
          supabase
            .from("pipeline_c_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .neq("status", "ready")
            .neq("status", "failed")
        ]);

        const totalCount = (pipelineATotal.count || 0) + (pipelineBTotal.count || 0) + (pipelineCTotal.count || 0);
        const validCount = (pipelineAValid.count || 0) + (pipelineBValid.count || 0) + (pipelineCValid.count || 0);
        const procCount = (pipelineAProcessing.count || 0) + (pipelineBProcessing.count || 0) + (pipelineCProcessing.count || 0);
        
        console.log('[BulkAssign] Manual mode counts:', {
          totalCount,
          validCount,
          processingCount: procCount
        });

        setDocumentCount(totalCount);
        setValidatedCount(validCount);
        setProcessingCount(procCount);
      }
    } catch (error) {
      console.error('[BulkAssign] Error counting documents:', error);
      toast.error('Errore nel conteggio documenti');
    }
  };

  useEffect(() => {
    if (open) {
      countDocuments();
      loadAgents();
    }
  }, [open, documentIds, folderName]);

  useEffect(() => {
    if (open && processingCount > 0) {
      const interval = setInterval(() => {
        countDocuments();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [open, processingCount]);

  const loadAgents = async () => {
    try {
      setLoadingAgents(true);
      const { data, error } = await supabase
        .from("agents")
        .select("id, name")
        .eq("active", true)
        .order("name");

      if (error) throw error;
      setAgents(data || []);
    } catch (error: any) {
      console.error("Error loading agents:", error);
      toast.error("Errore nel caricamento degli agenti");
    } finally {
      setLoadingAgents(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(agentId)) {
        newSet.delete(agentId);
      } else {
        newSet.add(agentId);
      }
      return newSet;
    });
  };

  const handleAssignDocuments = async () => {
    if (selectedAgentIds.size === 0) {
      toast.error("Seleziona almeno un agente");
      return;
    }

    if (validatedCount === 0) {
      toast.error("Nessun documento pronto per l'assegnazione");
      return;
    }

    try {
      setLoading(true);
      const agentsList = Array.from(selectedAgentIds);

      // Ottieni i documenti pronti per pipeline
      const readyDocuments: Array<{id: string, pipeline: 'a' | 'b' | 'c'}> = [];
      
      if (documentIds && documentIds.length > 0) {
        const [pipelineAReady, pipelineBReady, pipelineCReady] = await Promise.all([
          supabase.from("pipeline_a_documents")
            .select("id")
            .in("id", documentIds)
            .eq("status", "ready"),
          supabase.from("pipeline_b_documents")
            .select("id")
            .in("id", documentIds)
            .eq("status", "ready"),
          supabase.from("pipeline_c_documents")
            .select("id")
            .in("id", documentIds)
            .eq("status", "ready")
        ]);

        if (pipelineAReady.data) {
          pipelineAReady.data.forEach(d => readyDocuments.push({id: d.id, pipeline: 'a'}));
        }
        if (pipelineBReady.data) {
          pipelineBReady.data.forEach(d => readyDocuments.push({id: d.id, pipeline: 'b'}));
        }
        if (pipelineCReady.data) {
          pipelineCReady.data.forEach(d => readyDocuments.push({id: d.id, pipeline: 'c'}));
        }
      }

      let successful = 0;
      let failed = 0;

      for (const agent of agentsList) {
        for (const doc of readyDocuments) {
          try {
            const { data, error } = await supabase.functions.invoke('assign-document-to-agent', {
              body: { agentId: agent, documentId: doc.id, pipeline: doc.pipeline }
            });

            if (error || !data?.success) {
              failed++;
            } else {
              successful++;
            }
          } catch (error) {
            console.error(`Error assigning document ${doc.id} to agent ${agent}:`, error);
            failed++;
          }
        }
      }

      if (successful > 0) {
        toast.success(`${successful} assegnazioni completate con successo`);
      }
      if (failed > 0) {
        toast.error(`${failed} assegnazioni fallite`);
      }

      onAssigned();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error assigning documents:", error);
      toast.error("Errore durante l'assegnazione");
    } finally {
      setLoading(false);
    }
  };

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(agentSearchQuery.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Assegnazione Multipla</DialogTitle>
          <DialogDescription>
            Seleziona gli agenti per l'assegnazione
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold">{documentCount}</div>
              <div className="text-sm text-muted-foreground">Totale</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold">{validatedCount}</div>
              <div className="text-sm text-muted-foreground">Pronti</div>
            </div>
            <div className="text-center p-3 bg-yellow-50 rounded-lg">
              <div className="text-2xl font-bold">{processingCount}</div>
              <div className="text-sm text-muted-foreground">In elaborazione</div>
            </div>
          </div>

          {processingCount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 rounded-lg text-sm">
              <Clock className="h-4 w-4" />
              <span>Alcuni documenti sono ancora in elaborazione</span>
            </div>
          )}

          <div className="space-y-2">
            <Input
              placeholder="Cerca agente..."
              value={agentSearchQuery}
              onChange={(e) => setAgentSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>

          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {loadingAgents ? (
                <div className="text-center py-8">Caricamento agenti...</div>
              ) : (
                filteredAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent cursor-pointer"
                    onClick={() => toggleAgent(agent.id)}
                  >
                    <Checkbox
                      checked={selectedAgentIds.has(agent.id)}
                      onCheckedChange={() => toggleAgent(agent.id)}
                    />
                    <span className="flex-1">{agent.name}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Annulla
          </Button>
          <Button
            onClick={handleAssignDocuments}
            disabled={loading || selectedAgentIds.size === 0 || validatedCount === 0}
          >
            {loading ? "Assegnazione..." : "Salva Assegnazioni"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
