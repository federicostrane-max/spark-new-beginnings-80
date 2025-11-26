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
    pipeline?: 'a' | 'b' | 'c';
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

type PipelineType = 'legacy' | 'pipeline_b' | 'pipeline_c';

// Helper function to get current assignments based on pipeline
const getCurrentAssignments = async (documentId: string, pipeline: PipelineType) => {
  if (pipeline === 'pipeline_b') {
    const { data: chunks } = await supabase
      .from('pipeline_b_chunks_raw')
      .select('id')
      .eq('document_id', documentId);
    
    if (!chunks || chunks.length === 0) return [];
    
    const chunkIds = chunks.map(c => c.id);
    
    const { data } = await supabase
      .from('pipeline_b_agent_knowledge')
      .select('agent_id')
      .in('chunk_id', chunkIds);
    
    const uniqueAgents = [...new Set(data?.map(a => a.agent_id) || [])];
    return uniqueAgents.map(agent_id => ({ agent_id }));
  } else if (pipeline === 'pipeline_c') {
    const { data: chunks } = await supabase
      .from('pipeline_c_chunks_raw')
      .select('id')
      .eq('document_id', documentId);
    
    if (!chunks || chunks.length === 0) return [];
    
    const chunkIds = chunks.map(c => c.id);
    
    const { data } = await supabase
      .from('pipeline_c_agent_knowledge')
      .select('agent_id')
      .in('chunk_id', chunkIds);
    
    const uniqueAgents = [...new Set(data?.map(a => a.agent_id) || [])];
    return uniqueAgents.map(agent_id => ({ agent_id }));
  } else {
    // Pipeline A: Query pipeline_a_agent_knowledge
    const { data: chunks } = await supabase
      .from('pipeline_a_chunks_raw')
      .select('id')
      .eq('document_id', documentId);
    
    if (!chunks || chunks.length === 0) return [];
    
    const chunkIds = chunks.map(c => c.id);
    
    const { data } = await supabase
      .from('pipeline_a_agent_knowledge')
      .select('agent_id')
      .in('chunk_id', chunkIds);
    
    const uniqueAgents = [...new Set(data?.map(a => a.agent_id) || [])];
    return uniqueAgents.map(agent_id => ({ agent_id }));
  }
};

// Helper function to remove assignments based on pipeline
const removeAssignments = async (documentId: string, agentIds: string[], pipeline: PipelineType) => {
  if (pipeline === 'pipeline_b') {
    const { data: chunks } = await supabase
      .from('pipeline_b_chunks_raw')
      .select('id')
      .eq('document_id', documentId);
    
    if (!chunks || chunks.length === 0) return null;
    
    const chunkIds = chunks.map(c => c.id);
    
    const { error } = await supabase
      .from('pipeline_b_agent_knowledge')
      .delete()
      .in('agent_id', agentIds)
      .in('chunk_id', chunkIds);
    
    return error;
  } else if (pipeline === 'pipeline_c') {
    const { data: chunks } = await supabase
      .from('pipeline_c_chunks_raw')
      .select('id')
      .eq('document_id', documentId);
    
    if (!chunks || chunks.length === 0) return null;
    
    const chunkIds = chunks.map(c => c.id);
    
    const { error } = await supabase
      .from('pipeline_c_agent_knowledge')
      .delete()
      .in('agent_id', agentIds)
      .in('chunk_id', chunkIds);
    
    return error;
  } else {
    // Pipeline A: Delete from pipeline_a_agent_knowledge
    const { data: chunks } = await supabase
      .from('pipeline_a_chunks_raw')
      .select('id')
      .eq('document_id', documentId);
    
    if (!chunks || chunks.length === 0) return null;
    
    const chunkIds = chunks.map(c => c.id);
    
    const { error } = await supabase
      .from('pipeline_a_agent_knowledge')
      .delete()
      .in('agent_id', agentIds)
      .in('chunk_id', chunkIds);
    
    return error;
  }
};

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

  // Determine pipeline type
  const getPipelineType = (): PipelineType => {
    if (document.pipeline === 'b') return 'pipeline_b';
    if (document.pipeline === 'c') return 'pipeline_c';
    // Pipeline A is now the default (was 'legacy')
    return 'legacy'; // This now means Pipeline A
  };

  useEffect(() => {
    if (open) {
      loadAgents();
    }
  }, [open, document.id]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      const pipelineType = getPipelineType();
      
      // Verify document is ready for assignment based on pipeline
      if (pipelineType === 'pipeline_b') {
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
      } else if (pipelineType === 'pipeline_c') {
        const { data: docData, error: docError } = await supabase
          .from("pipeline_c_documents")
          .select("status")
          .eq("id", document.id)
          .single();
        
        if (docError) throw docError;
        
        if (docData.status !== 'ready') {
          toast.error(`Documento Pipeline C non pronto (status: ${docData.status})`);
          onOpenChange(false);
          return;
        }
      } else {
        // Pipeline A: Check document status
        const { data: docData, error: docError } = await supabase
          .from("pipeline_a_documents")
          .select("status")
          .eq("id", document.id)
          .single();
        
        if (docError) throw docError;
        
        if (docData.status !== 'ready') {
          toast.error(`Documento Pipeline A non pronto (status: ${docData.status})`);
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

      // Load existing assignments (pipeline-aware)
      const assignmentsData = await getCurrentAssignments(document.id, pipelineType);

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
      const pipelineType = getPipelineType();

      // Get current assignments (pipeline-aware)
      const currentAssignments = await getCurrentAssignments(document.id, pipelineType);
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

      // Remove unassigned agents (pipeline-aware)
      if (toRemove.length > 0) {
        console.log(`[AssignDialog] Removing ${toRemove.length} agent assignments from ${pipelineType}`);
        
        const error = await removeAssignments(document.id, toRemove, pipelineType);
        if (error) throw error;
        
        console.log(`[AssignDialog] ✓ Removed ${toRemove.length} assignments`);
      }

      // Add newly assigned agents
      if (toAdd.length > 0) {
        console.log(`[AssignDialog] Adding ${toAdd.length} new agent assignments via assign-document-to-agent`);
        
        // Initialize sync status map
        const initialSyncMap = new Map<string, 'pending' | 'syncing' | 'completed' | 'failed'>();
        toAdd.forEach(agentId => initialSyncMap.set(agentId, 'pending'));
        setSyncingAgents(initialSyncMap);
        
        // Assign each agent via edge function
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
              console.error('[AssignDialog] Assignment error for agent', agentId, assignError);
              setSyncingAgents(prev => new Map(prev).set(agentId, 'failed'));
              toast.error(`Errore nell'assegnazione all'agente`);
              continue;
            }

            if (!data?.success) {
              console.error('[AssignDialog] Assignment failed for agent', agentId, data?.error);
              setSyncingAgents(prev => new Map(prev).set(agentId, 'failed'));
              toast.error(data?.error || 'Assegnazione fallita');
              continue;
            }

            setSyncingAgents(prev => new Map(prev).set(agentId, 'completed'));
            console.log(`[AssignDialog] ✓ Document assigned to agent ${agentId}`);
            
          } catch (err) {
            console.error('[AssignDialog] Failed to assign document to agent', agentId, err);
            setSyncingAgents(prev => new Map(prev).set(agentId, 'failed'));
          }
        }
        
        // Show completion toast
        const completedCount = Array.from(syncingAgents.values()).filter(s => s === 'completed').length;
        const failedCount = Array.from(syncingAgents.values()).filter(s => s === 'failed').length;
        
        if (failedCount > 0) {
          toast.error(`${completedCount} agenti assegnati, ${failedCount} falliti`);
        } else {
          toast.success(`Documento assegnato a ${completedCount} agenti`);
        }
        
        onAssigned();
        onOpenChange(false);
      } else {
        toast.success("Assegnazione completata");
        onAssigned();
        onOpenChange(false);
      }
    } catch (error: any) {
      console.error("[AssignDialog] Error assigning document:", error);
      toast.error("Errore nell'assegnazione del documento");
    } finally {
      setAssigning(false);
      setSyncingAgents(new Map());
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
            {document.pipeline && (
              <Badge variant="secondary" className="text-xs">
                Pipeline {document.pipeline.toUpperCase()}
              </Badge>
            )}
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
