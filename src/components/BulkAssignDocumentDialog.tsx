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
      setSelectedAgentIds(new Set());
    }
  }, [open]);

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
    if (selectedAgentIds.size === 0) {
      toast.error("Seleziona almeno un agente");
      return;
    }

    try {
      setLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Create all assignments
      const assignments = [];
      for (const doc of documents) {
        for (const agentId of selectedAgentIds) {
          assignments.push({
            document_id: doc.id,
            agent_id: agentId,
            assignment_type: 'manual',
            assigned_by: user.id
          });
        }
      }

      // Batch upsert (ignores duplicates)
      const { error: assignError } = await supabase
        .from('agent_document_links')
        .upsert(assignments, { onConflict: 'document_id,agent_id', ignoreDuplicates: true });

      if (assignError) throw assignError;

      // Trigger sync for each document-agent pair
      const syncPromises = [];
      for (const doc of documents) {
        for (const agentId of selectedAgentIds) {
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

      // Execute all syncs in parallel
      await Promise.allSettled(syncPromises);

      toast.success(`${documents.length} documenti assegnati a ${selectedAgentIds.size} agenti`);
      onAssigned();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error assigning documents:", error);
      toast.error("Errore nell'assegnazione dei documenti");
    } finally {
      setLoading(false);
    }
  };

  const validatedDocs = documents.filter(d => d.validation_status === 'validated');
  const invalidDocs = documents.filter(d => d.validation_status !== 'validated');

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
                ({invalidDocs.length} {invalidDocs.length === 1 ? 'documento' : 'documenti'} non validato sarà ignorato)
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
          {selectedAgentIds.size > 0 && (
            <div className="p-3 rounded-md bg-muted space-y-2">
              <div className="text-sm font-medium">Riepilogo:</div>
              <div className="text-sm text-muted-foreground">
                Assegnerai <Badge variant="secondary">{validatedDocs.length}</Badge> {validatedDocs.length === 1 ? 'documento' : 'documenti'} a{" "}
                <Badge variant="secondary">{selectedAgentIds.size}</Badge> {selectedAgentIds.size === 1 ? 'agente' : 'agenti'}
                <span className="block mt-1">
                  Totale: <strong>{validatedDocs.length * selectedAgentIds.size}</strong> assegnazioni
                </span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annulla
          </Button>
          <Button
            onClick={handleAssign}
            disabled={loading || selectedAgentIds.size === 0 || validatedDocs.length === 0}
          >
            {loading ? "Assegnazione..." : "Assegna Tutto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
