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
import { Link as LinkIcon, Search } from "lucide-react";

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
  documentIds?: string[];       // For manual selection (max ~100 docs)
  folderName?: string;          // For folder selection (any quantity)
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

  const countDocuments = async () => {
    try {
      if (folderName) {
        // Use folder-based query for large selections
        const { count: totalCount } = await supabase
          .from("knowledge_documents")
          .select("id", { count: 'exact', head: true })
          .like("folder", `${folderName}%`);
        
        setDocumentCount(totalCount || 0);

        const { count: validCount } = await supabase
          .from("knowledge_documents")
          .select("id", { count: 'exact', head: true })
          .like("folder", `${folderName}%`)
          .eq("processing_status", "ready_for_assignment");
        
        setValidatedCount(validCount || 0);
      } else if (documentIds && documentIds.length > 0) {
        // Use .in() only for small selections (< 1000)
        const { count: totalCount } = await supabase
          .from("knowledge_documents")
          .select("id", { count: 'exact', head: true })
          .in("id", documentIds);
        
        setDocumentCount(totalCount || 0);

        const { count: validCount } = await supabase
          .from("knowledge_documents")
          .select("id", { count: 'exact', head: true })
          .in("id", documentIds)
          .eq("processing_status", "ready_for_assignment");
        
        setValidatedCount(validCount || 0);
      }
    } catch (error) {
      console.error("Error counting documents:", error);
      setDocumentCount(0);
      setValidatedCount(0);
    }
  };

  useEffect(() => {
    if (open) {
      loadAgents();
      countDocuments();
    }
  }, [open, documentIds, folderName]);

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

      // Pre-select agents ONLY for manual selections (not folder-based)
      if (documentIds && documentIds.length > 0 && documentIds.length < 100 && !folderName) {
        const { data: assignmentsData, error: assignmentsError } = await supabase
          .from("agent_document_links")
          .select("agent_id, document_id")
          .in("document_id", documentIds);

        if (assignmentsError) throw assignmentsError;

        // Count how many documents each agent is assigned to
        const agentCounts = new Map<string, number>();
        assignmentsData?.forEach(link => {
          agentCounts.set(link.agent_id, (agentCounts.get(link.agent_id) || 0) + 1);
        });

        // Pre-select only agents that are assigned to ALL selected documents
        const commonlyAssignedIds = new Set(
          Array.from(agentCounts.entries())
            .filter(([_, count]) => count === documentIds.length)
            .map(([agentId, _]) => agentId)
        );

        setSelectedAgentIds(commonlyAssignedIds);
      } else {
        // For folder selections or large selections, don't pre-select (too many docs)
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

  const handleSelectAll = () => {
    const filteredAgents = agentSearchQuery.trim() === ""
      ? agents
      : agents.filter(agent =>
          agent.name.toLowerCase().includes(agentSearchQuery.toLowerCase())
        );
    
    setSelectedAgentIds(new Set(filteredAgents.map(a => a.id)));
    toast.success(`${filteredAgents.length} ${filteredAgents.length === 1 ? 'agente selezionato' : 'agenti selezionati'}`);
  };

  const handleDeselectAll = () => {
    setSelectedAgentIds(new Set());
    toast.success("Tutti gli agenti deselezionati");
  };

  const handleAssign = async () => {
    if (selectedAgentIds.size === 0) {
      toast.error("Seleziona almeno un agente");
      return;
    }

    if (validatedCount === 0) {
      toast.error("Nessun documento validato da assegnare");
      return;
    }

    setLoading(true);

    try {
      // Step 1: Fetch ALL validated documents
      let query = supabase
        .from("knowledge_documents")
        .select("id")
        .eq("processing_status", "ready_for_assignment");

      if (folderName) {
        query = query.like("folder", `${folderName}%`);
      } else if (documentIds) {
        query = query.in("id", documentIds);
      }

      const { data: validatedDocs, error: fetchError } = await query;
      
      if (fetchError) throw fetchError;
      
      if (!validatedDocs || validatedDocs.length === 0) {
        toast.error("Nessun documento validato trovato");
        setLoading(false);
        return;
      }

      const validatedDocIds = validatedDocs.map(d => d.id);
      
      // Step 2: Fetch existing assignments for validated docs (with batching)
      const assignments = [];
      const batchSize = 1000;
      
      for (let i = 0; i < validatedDocIds.length; i += batchSize) {
        const batch = validatedDocIds.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from("agent_document_links")
          .select("agent_id, document_id")
          .in("document_id", batch);
        
        if (error) throw error;
        if (data) assignments.push(...data);
      }

      // Step 3: Calculate changes
      const existingMap = new Map<string, Set<string>>();
      assignments.forEach(link => {
        if (!existingMap.has(link.document_id)) {
          existingMap.set(link.document_id, new Set());
        }
        existingMap.get(link.document_id)!.add(link.agent_id);
      });

      const selectedAgents = Array.from(selectedAgentIds);
      const toDelete: Array<{ agent_id: string; document_id: string }> = [];
      const toInsert: Array<{ agent_id: string; document_id: string; assignment_type: string; assigned_by?: string }> = [];

      const { data: { user } } = await supabase.auth.getUser();
      
      validatedDocIds.forEach(docId => {
        const existingAgents = existingMap.get(docId) || new Set();
        
        // Remove unselected agents
        existingAgents.forEach(agentId => {
          if (!selectedAgentIds.has(agentId)) {
            toDelete.push({ agent_id: agentId, document_id: docId });
          }
        });
        
        // Add newly selected agents
        selectedAgents.forEach(agentId => {
          if (!existingAgents.has(agentId)) {
            toInsert.push({
              agent_id: agentId,
              document_id: docId,
              assignment_type: 'manual',
              assigned_by: user?.id
            });
          }
        });
      });

      // Step 4: Execute deletions (batched)
      if (toDelete.length > 0) {
        for (let i = 0; i < toDelete.length; i += batchSize) {
          const batch = toDelete.slice(i, i + batchSize);
          const agentIds = [...new Set(batch.map(x => x.agent_id))];
          const docIds = [...new Set(batch.map(x => x.document_id))];
          
          const { error } = await supabase
            .from("agent_document_links")
            .delete()
            .in("agent_id", agentIds)
            .in("document_id", docIds);
          
          if (error) throw error;
        }
      }

      // Step 5: Execute insertions (batched)
      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i += batchSize) {
          const batch = toInsert.slice(i, i + batchSize);
          const { error } = await supabase
            .from("agent_document_links")
            .insert(batch);
          
          if (error) throw error;
        }
        
        // Sync new assignments
        const newAgentDocPairs = new Map<string, Set<string>>();
        toInsert.forEach(({ agent_id, document_id }) => {
          if (!newAgentDocPairs.has(agent_id)) {
            newAgentDocPairs.set(agent_id, new Set());
          }
          newAgentDocPairs.get(agent_id)!.add(document_id);
        });

        for (const [agentId, docIds] of newAgentDocPairs.entries()) {
          for (const docId of docIds) {
            await supabase.functions.invoke("sync-pool-document", {
              body: { agentId, documentId: docId }
            });
          }
        }
      }

      toast.success(
        `Assegnazione completata! ${validatedDocs.length} documenti → ${selectedAgentIds.size} agenti`
      );
      
      onAssigned();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Assignment error:", error);
      toast.error(`Errore durante l'assegnazione: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            Assegnazione Multipla
          </DialogTitle>
          <DialogDescription>
            Documenti: {validatedCount}
            {documentCount > validatedCount && (
              <span className="text-amber-600 ml-2">
                ({documentCount - validatedCount} non validati saranno ignorati)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Agent selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Seleziona agenti:</h4>
              <div className="text-xs text-muted-foreground">
                {selectedAgentIds.size} / {agents.length} selezionati
              </div>
            </div>
            
            {/* Search Input */}
            {agents.length > 5 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca agente..."
                  value={agentSearchQuery}
                  onChange={(e) => setAgentSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            )}
            
            {/* Select/Deselect All Buttons */}
            {agents.length > 0 && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={loadingAgents}
                  className="flex-1"
                >
                  Seleziona tutti
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDeselectAll}
                  disabled={loadingAgents || selectedAgentIds.size === 0}
                  className="flex-1"
                >
                  Deseleziona tutti
                </Button>
              </div>
            )}
            
            {/* Agent List */}
            <ScrollArea className="h-64 rounded-md border p-3">
              {loadingAgents ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Caricamento agenti...
                </div>
              ) : agents.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Nessun agente disponibile
                </div>
              ) : (() => {
                  const filteredAgents = agentSearchQuery.trim() === ""
                    ? agents
                    : agents.filter(agent =>
                        agent.name.toLowerCase().includes(agentSearchQuery.toLowerCase())
                      );
                  
                  return filteredAgents.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      Nessun agente trovato per "{agentSearchQuery}"
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredAgents.map((agent) => (
                        <div key={agent.id} className="flex items-center space-x-3">
                          <Checkbox
                            id={`agent-${agent.id}`}
                            checked={selectedAgentIds.has(agent.id)}
                            onCheckedChange={() => handleToggleAgent(agent.id)}
                          />
                          <label
                            htmlFor={`agent-${agent.id}`}
                            className="text-sm font-medium leading-none cursor-pointer flex-1"
                          >
                            {agent.name}
                          </label>
                        </div>
                      ))}
                    </div>
                  );
                })()
              }
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annulla
          </Button>
        <Button
          onClick={handleAssign}
          disabled={loading || validatedCount === 0 || selectedAgentIds.size === 0}
        >
          {loading ? "Salvando..." : "Salva Assegnazioni"}
        </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
