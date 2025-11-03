import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
}

interface AssignDocumentDialogProps {
  document: {
    id: string;
    file_name: string;
    ai_summary: string;
    keywords: string[];
    topics: string[];
    complexity_level: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

export const AssignDocumentDialog = ({
  document,
  open,
  onOpenChange,
  onAssigned,
}: AssignDocumentDialogProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (open) {
      loadAgents();
    }
  }, [open, document.id]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      
      // Load all agents
      const { data: agentsData, error: agentsError } = await supabase
        .from("agents")
        .select("id, name, slug, description")
        .eq("active", true);

      if (agentsError) throw agentsError;

      // Load existing assignments for this document
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from("agent_document_links")
        .select("agent_id")
        .eq("document_id", document.id);

      if (assignmentsError) throw assignmentsError;

      setAgents(agentsData || []);
      
      // Pre-select already assigned agents
      const assignedIds = new Set(
        assignmentsData?.map((a) => a.agent_id) || []
      );
      setSelectedAgents(assignedIds);
    } catch (error: any) {
      console.error("Error loading agents:", error);
      toast.error("Errore nel caricamento degli agenti");
    } finally {
      setLoading(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(agentId)) {
        newSet.delete(agentId);
      } else {
        newSet.add(agentId);
      }
      return newSet;
    });
  };

  const handleAssign = async () => {
    try {
      setAssigning(true);

      // Get current assignments
      const { data: currentAssignments } = await supabase
        .from("agent_document_links")
        .select("agent_id")
        .eq("document_id", document.id);

      const currentAgentIds = new Set(
        currentAssignments?.map((a) => a.agent_id) || []
      );

      // Determine which to add and which to remove
      const toAdd = Array.from(selectedAgents).filter(
        (id) => !currentAgentIds.has(id)
      );
      const toRemove = Array.from(currentAgentIds).filter(
        (id) => !selectedAgents.has(id)
      );

      // Remove unassigned agents
      if (toRemove.length > 0) {
        const { error: deleteError } = await supabase
          .from("agent_document_links")
          .delete()
          .eq("document_id", document.id)
          .in("agent_id", toRemove);

        if (deleteError) throw deleteError;

        // Delete chunks from removed agents
        for (const agentId of toRemove) {
          await supabase
            .from("agent_knowledge")
            .delete()
            .eq("pool_document_id", document.id)
            .eq("agent_id", agentId)
            .eq("source_type", "pool");
        }
      }

      // Add newly assigned agents
      if (toAdd.length > 0) {
        const { error: insertError } = await supabase
          .from("agent_document_links")
          .insert(
            toAdd.map((agentId) => ({
              document_id: document.id,
              agent_id: agentId,
              assignment_type: "manual",
              confidence_score: 1.0,
            }))
          );

        if (insertError) throw insertError;

        // Sync document to each newly assigned agent
        for (const agentId of toAdd) {
          const agentName = agents.find(a => a.id === agentId)?.name || 'Agente';
          toast.loading(`Sincronizzazione per ${agentName}...`);
          
          const { data: syncData, error: syncError } = await supabase.functions.invoke(
            "sync-pool-document",
            {
              body: {
                documentId: document.id,
                agentId: agentId,
              },
            }
          );

          if (syncError) {
            console.error(`[AssignDialog] Sync failed for agent ${agentId}:`, syncError);
            toast.error(`Errore nella sincronizzazione per ${agentName}`);
          } else {
            console.log(`[AssignDialog] Sync successful:`, syncData);
            if (syncData?.chunksCount) {
              toast.success(`${syncData.chunksCount} chunk aggiunti per ${agentName}`);
            } else {
              toast.info(`Documento già sincronizzato per ${agentName}`);
            }
          }
        }
      }

      toast.success("Assegnazione completata");
      onAssigned();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error assigning document:", error);
      toast.error("Errore nell'assegnazione del documento");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assegna Documento agli Agenti</DialogTitle>
          <DialogDescription>
            Seleziona gli agenti che avranno accesso a questo documento
          </DialogDescription>
        </DialogHeader>

        {/* Document Preview */}
        <div className="bg-muted p-4 rounded-lg space-y-2">
          <div className="font-medium">{document.file_name}</div>
          {document.ai_summary && (
            <p className="text-sm text-muted-foreground">{document.ai_summary}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            {document.complexity_level && (
              <Badge variant="secondary">{document.complexity_level}</Badge>
            )}
            {document.keywords?.slice(0, 5).map((keyword, idx) => (
              <Badge key={idx} variant="outline">
                {keyword}
              </Badge>
            ))}
          </div>
        </div>

        {/* Agents List */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Nessun agente disponibile
          </div>
        ) : (
          <div className="space-y-3">
            <div className="font-medium text-sm">Agenti Disponibili</div>
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                onClick={() => toggleAgent(agent.id)}
              >
                <Checkbox
                  checked={selectedAgents.has(agent.id)}
                  onCheckedChange={() => toggleAgent(agent.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{agent.name}</div>
                  <div className="text-sm text-muted-foreground line-clamp-2">
                    {agent.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button onClick={handleAssign} disabled={assigning}>
            {assigning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Assegnazione...
              </>
            ) : (
              `Assegna a ${selectedAgents.size} agenti`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
