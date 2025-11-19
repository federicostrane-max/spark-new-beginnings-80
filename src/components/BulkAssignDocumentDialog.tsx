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
import { Link as LinkIcon } from "lucide-react";

interface Agent {
  id: string;
  name: string;
}

interface KnowledgeDocument {
  id: string;
  file_name: string;
  validation_status: string;
  processing_status: string;
}

interface BulkAssignDocumentDialogProps {
  documents: KnowledgeDocument[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

export const BulkAssignDocumentDialog = ({
  documents,
  open,
  onOpenChange,
  onAssigned,
}: BulkAssignDocumentDialogProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(true);

  useEffect(() => {
    if (open) {
      loadAgents();
    }
  }, [open, documents]);

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

      // Load existing assignments for the selected documents
      if (documents.length > 0) {
        const { data: assignmentsData, error: assignmentsError } = await supabase
          .from("agent_document_links")
          .select("agent_id, document_id")
          .in("document_id", documents.map(d => d.id));

        if (assignmentsError) throw assignmentsError;

        // Count how many documents each agent is assigned to
        const agentCounts = new Map<string, number>();
        assignmentsData?.forEach(link => {
          agentCounts.set(link.agent_id, (agentCounts.get(link.agent_id) || 0) + 1);
        });

        // Pre-select only agents that are assigned to ALL selected documents
        const commonlyAssignedIds = new Set(
          Array.from(agentCounts.entries())
            .filter(([_, count]) => count === documents.length)
            .map(([agentId, _]) => agentId)
        );

        setSelectedAgentIds(commonlyAssignedIds);
      } else {
        setSelectedAgentIds(new Set());
      }
    } catch (error: any) {
      console.error("Error loading agents:", error);
      toast.error("Errore nel caricamento degli agenti");
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleToggleAgent = (agentId: string) => {
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

  const handleAssign = async () => {
    try {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const syncPromises = [];
      let totalAdded = 0;
      let totalRemoved = 0;

      // Process each validated document
      for (const doc of validatedDocs) {
        // Get current assignments for this document
        const { data: currentAssignments } = await supabase
          .from("agent_document_links")
          .select("agent_id")
          .eq("document_id", doc.id);

        const currentAgentIds = new Set(
          currentAssignments?.map(a => a.agent_id) || []
        );

        // Determine who to add and who to remove
        const toAdd = Array.from(selectedAgentIds).filter(
          id => !currentAgentIds.has(id)
        );
        const toRemove = Array.from(currentAgentIds).filter(
          id => !selectedAgentIds.has(id)
        );

        // Remove deselected agents
        if (toRemove.length > 0) {
          const { error: deleteError } = await supabase
            .from("agent_document_links")
            .delete()
            .eq("document_id", doc.id)
            .in("agent_id", toRemove);

          if (deleteError) throw deleteError;
          totalRemoved += toRemove.length;
        }

        // Add new agents
        if (toAdd.length > 0) {
          const { error: insertError } = await supabase
            .from("agent_document_links")
            .insert(
              toAdd.map(agentId => ({
                document_id: doc.id,
                agent_id: agentId,
                assignment_type: 'manual',
                assigned_by: user.id
              }))
            );

          if (insertError) throw insertError;
          totalAdded += toAdd.length;

          // Sync only newly added agents
          for (const agentId of toAdd) {
            syncPromises.push(
              supabase.functions.invoke('sync-pool-document', {
                body: {
                  documentId: doc.id,
                  agentId: agentId
                }
              })
            );
          }
        }
      }

      // Execute all syncs in parallel
      if (syncPromises.length > 0) {
        await Promise.allSettled(syncPromises);
      }

      // Show appropriate success message
      if (selectedAgentIds.size === 0) {
        toast.success(`Assegnazioni rimosse per ${validatedDocs.length} ${validatedDocs.length === 1 ? 'documento' : 'documenti'}`);
      } else {
        const parts = [];
        if (totalAdded > 0) parts.push(`${totalAdded} aggiunte`);
        if (totalRemoved > 0) parts.push(`${totalRemoved} rimosse`);
        toast.success(`${validatedDocs.length} ${validatedDocs.length === 1 ? 'documento aggiornato' : 'documenti aggiornati'} (${parts.join(', ')})`);
      }

      onAssigned();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error assigning documents:", error);
      toast.error("Errore nell'assegnazione dei documenti");
    } finally {
      setLoading(false);
    }
  };

  // Only show ready_for_assignment documents
  const validatedDocs = documents.filter(d => 
    d.processing_status === 'ready_for_assignment'
  );
  const invalidDocs = documents.filter(d => 
    d.processing_status !== 'ready_for_assignment'
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Assegnazione Multipla
          </DialogTitle>
          <DialogDescription>
            Assegna {validatedDocs.length} {validatedDocs.length === 1 ? 'documento' : 'documenti'} a uno o più agenti
            {invalidDocs.length > 0 && (
              <span className="block mt-1 text-amber-600">
                ({invalidDocs.length} {invalidDocs.length === 1 ? 'documento' : 'documenti'} non pronto sarà ignorato)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Documents preview */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Documenti da assegnare:</h4>
            <ScrollArea className="h-24 rounded-md border p-3">
              <div className="space-y-1">
                {validatedDocs.map((doc) => (
                  <div key={doc.id} className="text-sm text-muted-foreground truncate" title={doc.file_name}>
                    • {doc.file_name}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Agent selection */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Seleziona agenti:</h4>
            <ScrollArea className="h-48 rounded-md border p-3">
              {loadingAgents ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Caricamento agenti...
                </div>
              ) : agents.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Nessun agente disponibile
                </div>
              ) : (
                <div className="space-y-3">
                  {agents.map((agent) => (
                    <div key={agent.id} className="flex items-center space-x-3">
                      <Checkbox
                        id={`agent-${agent.id}`}
                        checked={selectedAgentIds.has(agent.id)}
                        onCheckedChange={() => handleToggleAgent(agent.id)}
                      />
                      <label
                        htmlFor={`agent-${agent.id}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                      >
                        {agent.name}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Preview */}
          <div className="p-3 rounded-md bg-muted space-y-2">
            <div className="text-sm font-medium">Riepilogo:</div>
            {selectedAgentIds.size > 0 ? (
              <div className="text-sm text-muted-foreground">
                Assegnerai <Badge variant="secondary">{validatedDocs.length}</Badge> {validatedDocs.length === 1 ? 'documento' : 'documenti'} a{" "}
                <Badge variant="secondary">{selectedAgentIds.size}</Badge> {selectedAgentIds.size === 1 ? 'agente' : 'agenti'}
                <span className="block mt-1">
                  Totale: <strong>{validatedDocs.length * selectedAgentIds.size}</strong> assegnazioni
                </span>
              </div>
            ) : (
              <div className="text-sm text-amber-600">
                ⚠️ Rimuoverai tutte le assegnazioni per {validatedDocs.length === 1 ? 'questo documento' : 'questi documenti'}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annulla
          </Button>
          <Button
            onClick={handleAssign}
            disabled={loading || validatedDocs.length === 0}
          >
            {loading ? "Salvando..." : "Salva Assegnazioni"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
