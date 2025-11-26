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
    ai_summary?: string | null;
    keywords?: string[];
    topics?: string[];
    complexity_level?: string;
    pipeline?: 'a' | 'b' | 'c';
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}

// Helper function to get current assignments based on pipeline
const getCurrentAssignments = async (documentId: string, pipeline: 'a' | 'b' | 'c') => {
  if (pipeline === 'a') {
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
  } else if (pipeline === 'b') {
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
  } else {
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
  }
};

// Helper function to remove assignments based on pipeline
const removeAssignments = async (documentId: string, agentIds: string[], pipeline: 'a' | 'b' | 'c') => {
  if (pipeline === 'a') {
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
  } else if (pipeline === 'b') {
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
  } else {
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

  const pipeline = document.pipeline || 'a';

  useEffect(() => {
    if (open) {
      loadAgents();
    }
  }, [open, document.id]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      
      // Verify document is ready
      const tableName = `pipeline_${pipeline}_documents` as 'pipeline_a_documents' | 'pipeline_b_documents' | 'pipeline_c_documents';
      const { data: docData, error: docError } = await supabase
        .from(tableName)
        .select("status")
        .eq("id", document.id)
        .single();
      
      if (docError) throw docError;
      
      if (docData.status !== 'ready') {
        toast.error(`Documento Pipeline ${pipeline.toUpperCase()} non pronto (status: ${docData.status})`);
        onOpenChange(false);
        return;
      }
      
      // Load all agents
      const { data: agentsData, error: agentsError } = await supabase
        .from("agents")
        .select("id, name, slug, description")
        .eq("active", true);

      if (agentsError) throw agentsError;

      // Load existing assignments
      const assignmentsData = await getCurrentAssignments(document.id, pipeline);

      setAgents(agentsData || []);
      
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
      
      // Get previously assigned agents
      const previousAssignments = await getCurrentAssignments(document.id, pipeline);
      const previousAgentIds = new Set(previousAssignments.map(a => a.agent_id));
      const selectedAgentIds = Array.from(selectedAgents);
      
      // Agents to add
      const toAdd = selectedAgentIds.filter(id => !previousAgentIds.has(id));
      
      // Agents to remove
      const toRemove = Array.from(previousAgentIds).filter(id => !selectedAgents.has(id));
      
      // Remove deselected agents
      if (toRemove.length > 0) {
        const error = await removeAssignments(document.id, toRemove, pipeline);
        if (error) throw error;
      }
      
      // Add new agents
      if (toAdd.length > 0) {
        // Initialize sync status
        const newSyncingAgents = new Map(syncingAgents);
        toAdd.forEach(agentId => newSyncingAgents.set(agentId, 'pending'));
        setSyncingAgents(newSyncingAgents);

        for (const agentId of toAdd) {
          try {
            setSyncingAgents(prev => new Map(prev).set(agentId, 'syncing'));
            
            const { data, error } = await supabase.functions.invoke('assign-document-to-agent', {
              body: { agentId, documentId: document.id, pipeline }
            });

            if (error) throw error;
            
            if (data?.success) {
              setSyncingAgents(prev => new Map(prev).set(agentId, 'completed'));
            } else {
              throw new Error(data?.error || 'Assignment failed');
            }
          } catch (error) {
            console.error(`Failed to assign to agent ${agentId}:`, error);
            setSyncingAgents(prev => new Map(prev).set(agentId, 'failed'));
          }
        }
      }
      
      toast.success("Assegnazioni aggiornate con successo");
      onAssigned();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error assigning document:", error);
      toast.error("Errore nell'assegnazione del documento");
    } finally {
      setAssigning(false);
    }
  };

  const getSyncStatusIcon = (agentId: string) => {
    const status = syncingAgents.get(agentId);
    if (status === 'syncing') return <Loader2 className="h-4 w-4 animate-spin" />;
    if (status === 'completed') return <Check className="h-4 w-4 text-green-500" />;
    if (status === 'failed') return <X className="h-4 w-4 text-red-500" />;
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Assegna Documento ad Agenti</DialogTitle>
          <DialogDescription>
            Seleziona gli agenti che potranno accedere a questo documento
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Documento</h3>
            <div className="p-3 rounded-lg border">
              <p className="font-medium">{document.file_name}</p>
              <Badge variant="outline" className="mt-1">Pipeline {pipeline.toUpperCase()}</Badge>
              {document.ai_summary && (
                <p className="text-sm text-muted-foreground mt-2">
                  {document.ai_summary.substring(0, 150)}...
                </p>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Agenti ({selectedAgents.size} selezionati)
              </h3>
              <div className="space-y-2">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent cursor-pointer"
                    onClick={() => toggleAgent(agent.id)}
                  >
                    <Checkbox
                      checked={selectedAgents.has(agent.id)}
                      onCheckedChange={() => toggleAgent(agent.id)}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{agent.name}</p>
                        {getSyncStatusIcon(agent.id)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {agent.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={assigning}>
            Annulla
          </Button>
          <Button onClick={handleAssign} disabled={loading || assigning}>
            {assigning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salva Assegnazioni
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
