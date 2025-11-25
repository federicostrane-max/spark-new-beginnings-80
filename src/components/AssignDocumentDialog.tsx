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
import { Loader2, Check, X } from "lucide-react";

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
    keywords?: string[];
    topics?: string[];
    complexity_level?: string;
    pipeline?: 'a' | 'b';
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
  const [syncingAgents, setSyncingAgents] = useState<Map<string, 'pending' | 'syncing' | 'completed' | 'failed'>>(new Map());

  useEffect(() => {
    if (open) {
      loadAgents();
    }
  }, [open, document.id]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      
      // Verify document is ready for assignment based on pipeline
      if (document.pipeline === 'b') {
        // Pipeline B: Check status='ready' in pipeline_b_documents
        const { data: docData, error: docError } = await supabase
          .from("pipeline_b_documents")
          .select("status")
          .eq("id", document.id)
          .single();
        
        if (docError) throw docError;
        
        if (docData.status !== 'ready') {
          toast.error(`Documento Pipeline B non pronto (status: ${docData.status})`);
          onOpenChange(false);
          return;
        }
      } else {
        // Legacy: Check validation_status and processing_status
        const { data: docData, error: docError } = await supabase
          .from("knowledge_documents")
          .select("validation_status, processing_status")
          .eq("id", document.id)
          .single();
        
        if (docError) throw docError;
        
        if (docData.validation_status !== 'validated' || docData.processing_status !== 'ready_for_assignment') {
          toast.error("Questo documento non è pronto per essere assegnato");
          onOpenChange(false);
          return;
        }
      }
      
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

  const pollSyncStatus = async (documentId: string, agentIds: string[]) => {
    const maxAttempts = 60; // 60 secondi (1 poll al secondo)
    let attempts = 0;
    
    const checkStatus = async (): Promise<void> => {
      const { data } = await supabase
        .from("agent_document_links")
        .select("agent_id, sync_status")
        .eq("document_id", documentId)
        .in("agent_id", agentIds);
      
      // Aggiorna lo stato per ogni agente
      const statusMap = new Map<string, 'pending' | 'syncing' | 'completed' | 'failed'>();
      data?.forEach(link => {
        statusMap.set(link.agent_id, link.sync_status as 'pending' | 'syncing' | 'completed' | 'failed');
      });
      setSyncingAgents(statusMap);
      
      // Controlla se tutti sono completati o falliti
      const allDone = data?.every(link => 
        link.sync_status === 'completed' || link.sync_status === 'failed'
      );
      
      if (allDone) {
        const completedCount = data?.filter(link => link.sync_status === 'completed').length || 0;
        const failedCount = data?.filter(link => link.sync_status === 'failed').length || 0;
        
        if (failedCount > 0) {
          toast.error(`${completedCount} agenti sincronizzati, ${failedCount} falliti`);
        } else {
          toast.success(`Sincronizzazione completata per ${completedCount} agenti`);
        }
        return;
      }
      
      if (attempts >= maxAttempts) {
        toast.error("Timeout: la sincronizzazione sta impiegando troppo tempo");
        return;
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
      return checkStatus();
    };
    
    await checkStatus();
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

      // Remove unassigned agents (only delete links, not chunks - they're shared)
      if (toRemove.length > 0) {
        console.log(`[AssignDialog] Removing ${toRemove.length} agent assignments`);
        
        const { error: deleteError } = await supabase
          .from("agent_document_links")
          .delete()
          .eq("document_id", document.id)
          .in("agent_id", toRemove);

        if (deleteError) throw deleteError;
        
        console.log(`[AssignDialog] ✓ Removed agent_document_links for ${toRemove.length} agents`);
        console.log(`[AssignDialog] NOTE: Chunks remain in agent_knowledge (shared pool)`);
      }

      // Add newly assigned agents and sync
      if (toAdd.length > 0) {
        console.log(`[AssignDialog] Adding ${toAdd.length} new agent assignments`);
        
        // Inizializza lo stato di sincronizzazione
        const initialSyncMap = new Map<string, 'pending' | 'syncing' | 'completed' | 'failed'>();
        toAdd.forEach(agentId => initialSyncMap.set(agentId, 'pending'));
        setSyncingAgents(initialSyncMap);
        
        // Use assign-document-to-agent edge function for both pipelines
        console.log(`[AssignDialog] Using assign-document-to-agent for pipeline ${document.pipeline || 'a'}`);
        
        for (const agentId of toAdd) {
          try {
            setSyncingAgents(prev => new Map(prev).set(agentId, 'syncing'));
            
            const { data, error: assignError } = await supabase.functions.invoke(
              'assign-document-to-agent',
              { 
                body: { 
                  agentId, 
                  documentId: document.id,
                  pipeline: document.pipeline || 'a'
                } 
              }
            );
            
            if (assignError) {
              console.error('Assignment error for agent', agentId, assignError);
              setSyncingAgents(prev => new Map(prev).set(agentId, 'failed'));
              toast.error(`Errore nell'assegnazione all'agente`);
              continue;
            }

            if (!data?.success) {
              console.error('Assignment failed for agent', agentId, data?.error);
              setSyncingAgents(prev => new Map(prev).set(agentId, 'failed'));
              toast.error(data?.error || 'Assegnazione fallita');
              continue;
            }

            setSyncingAgents(prev => new Map(prev).set(agentId, 'completed'));
            console.log(`✓ Document assigned to agent ${agentId}`);
            
          } catch (err) {
            console.error('Failed to assign document to agent', agentId, err);
            setSyncingAgents(prev => new Map(prev).set(agentId, 'failed'));
          }
        }
        
        // Avvia il polling dello stato
        await pollSyncStatus(document.id, toAdd);
        
        onAssigned();
        onOpenChange(false);
      } else {
        toast.success("Assegnazione completata");
        onAssigned();
        onOpenChange(false);
      }
    } catch (error: any) {
      console.error("Error assigning document:", error);
      
      // Check for RLS policy violation
      if (error.message?.includes('prevent_linking_invalid_documents')) {
        toast.error("Questo documento non può essere assegnato perché non è validato");
      } else {
        toast.error("Errore nell'assegnazione del documento");
      }
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
        <div className="bg-muted p-3 md:p-4 rounded-lg space-y-2">
          <div className="font-medium text-sm md:text-base break-words">{document.file_name}</div>
          {document.ai_summary && (
            <p className="text-xs md:text-sm text-muted-foreground line-clamp-3">{document.ai_summary}</p>
          )}
          <div className="flex flex-wrap gap-1.5 md:gap-2 mt-2">
            {document.complexity_level && (
              <Badge variant="secondary" className="text-xs">{document.complexity_level}</Badge>
            )}
            {document.keywords?.slice(0, 5).map((keyword, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
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
          <div className="space-y-2 md:space-y-3">
            <div className="font-medium text-sm">Agenti Disponibili ({agents.length})</div>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2">
              {agents.map((agent) => {
                const syncStatus = syncingAgents.get(agent.id);
                return (
                  <label
                    key={agent.id}
                    htmlFor={`agent-${agent.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      id={`agent-${agent.id}`}
                      checked={selectedAgents.has(agent.id)}
                      onCheckedChange={() => toggleAgent(agent.id)}
                      className="mt-0.5"
                      disabled={!!syncStatus}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm md:text-base flex items-center gap-2">
                        {agent.name}
                        {syncStatus === 'syncing' && (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        )}
                        {syncStatus === 'completed' && (
                          <Check className="h-4 w-4 text-green-500" />
                        )}
                        {syncStatus === 'failed' && (
                          <X className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                      <div className="text-xs md:text-sm text-muted-foreground line-clamp-2">
                        {agent.description}
                      </div>
                      {syncStatus && (
                        <div className="text-xs mt-1 font-medium">
                          {syncStatus === 'pending' && 'In attesa...'}
                          {syncStatus === 'syncing' && 'Sincronizzazione in corso...'}
                          {syncStatus === 'completed' && 'Sincronizzato ✓'}
                          {syncStatus === 'failed' && 'Sincronizzazione fallita ✗'}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={syncingAgents.size > 0}
            className="w-full sm:w-auto"
          >
            {syncingAgents.size > 0 ? "Sincronizzazione in corso..." : "Annulla"}
          </Button>
          <Button 
            onClick={handleAssign} 
            disabled={assigning || selectedAgents.size === 0 || syncingAgents.size > 0}
            className="w-full sm:w-auto"
          >
            {assigning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sincronizzazione...
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
