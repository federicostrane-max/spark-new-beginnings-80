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

interface KnowledgeDocument {
  id: string;
  file_name: string;
  validation_status: string;
  processing_status: string;
  pipeline?: string; // 'a' (legacy), 'b', 'c'
}

type PipelineType = 'legacy' | 'pipeline_b' | 'pipeline_c';

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
  const [processingCount, setProcessingCount] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string>("");

  const countDocuments = async () => {
    try {
      if (folderName) {
        // Folder-based: count from knowledge_documents only (Pipeline B doesn't use folders)
        const { count: totalCount } = await supabase
          .from("knowledge_documents")
          .select("id", { count: 'exact', head: true })
          .like("folder", `${folderName}%`);
        
        setDocumentCount(totalCount || 0);

        const { count: validCount } = await supabase
          .from("knowledge_documents")
          .select("id", { count: 'exact', head: true })
          .like("folder", `${folderName}%`)
          .eq("processing_status", "ready_for_assignment")
          .eq("validation_status", "validated");
        
        setValidatedCount(validCount || 0);
      } else if (documentIds && documentIds.length > 0) {
        // Manual selection: check ALL THREE pipelines
        const [
          legacyTotal, pipelineBTotal, pipelineCTotal,
          legacyValid, pipelineBValid, pipelineCValid,
          pipelineBProcessing, pipelineCProcessing
        ] = await Promise.all([
          // Legacy total
          supabase
            .from("knowledge_documents")
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
          // Legacy valid
          supabase
            .from("knowledge_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .eq("processing_status", "ready_for_assignment")
            .eq("validation_status", "validated"),
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
          // Pipeline B processing
          supabase
            .from("pipeline_b_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .in("status", ["ingested", "processing", "chunked"]),
          // Pipeline C processing
          supabase
            .from("pipeline_c_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .in("status", ["ingested", "processing", "chunked"])
        ]);
        
        const totalCount = (legacyTotal.count || 0) + (pipelineBTotal.count || 0) + (pipelineCTotal.count || 0);
        const validCount = (legacyValid.count || 0) + (pipelineBValid.count || 0) + (pipelineCValid.count || 0);
        const processingCount = (pipelineBProcessing.count || 0) + (pipelineCProcessing.count || 0);
        
        setDocumentCount(totalCount);
        setValidatedCount(validCount);
        setProcessingCount(processingCount);
      }
    } catch (error) {
      console.error("Error counting documents:", error);
      setDocumentCount(0);
      setValidatedCount(0);
      setProcessingCount(0);
    }
  };

  useEffect(() => {
    if (open) {
      loadAgents();
      countDocuments();
    }
  }, [open, documentIds, folderName]);

  // Auto-refresh when documents are processing
  useEffect(() => {
    if (!open || processingCount === 0) return;

    const interval = setInterval(() => {
      console.log('[BulkAssignDocumentDialog] 🔄 Auto-refresh: checking for ready documents...');
      countDocuments();
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [open, processingCount, documentIds, folderName]);

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

  // Pipeline-aware helper: Get existing assignments
  const getCurrentAssignments = async (documentIds: string[], pipeline: PipelineType) => {
    if (pipeline === 'pipeline_b') {
      const { data } = await supabase
        .from('pipeline_b_chunks_raw')
        .select('id, document_id')
        .in('document_id', documentIds);
      
      if (!data) return [];
      
      const chunkIds = data.map(c => c.id);
      const { data: assignments } = await supabase
        .from('pipeline_b_agent_knowledge')
        .select('agent_id, chunk_id')
        .in('chunk_id', chunkIds);
      
      // Map back to document_id
      const chunkToDoc = new Map(data.map(c => [c.id, c.document_id]));
      return (assignments || []).map(a => ({
        agent_id: a.agent_id,
        document_id: chunkToDoc.get(a.chunk_id)!
      }));
    } else if (pipeline === 'pipeline_c') {
      const { data } = await supabase
        .from('pipeline_c_chunks_raw')
        .select('id, document_id')
        .in('document_id', documentIds);
      
      if (!data) return [];
      
      const chunkIds = data.map(c => c.id);
      const { data: assignments } = await supabase
        .from('pipeline_c_agent_knowledge')
        .select('agent_id, chunk_id')
        .in('chunk_id', chunkIds);
      
      const chunkToDoc = new Map(data.map(c => [c.id, c.document_id]));
      return (assignments || []).map(a => ({
        agent_id: a.agent_id,
        document_id: chunkToDoc.get(a.chunk_id)!
      }));
    } else {
      // Legacy pipeline
      const { data } = await supabase
        .from('agent_document_links')
        .select('agent_id, document_id')
        .in('document_id', documentIds);
      
      return data || [];
    }
  };

  // Pipeline-aware helper: Remove assignments
  const removeAssignments = async (toDelete: Array<{ agent_id: string; document_id: string }>, pipeline: PipelineType) => {
    if (pipeline === 'pipeline_b') {
      const docIds = [...new Set(toDelete.map(x => x.document_id))];
      const agentIds = [...new Set(toDelete.map(x => x.agent_id))];
      
      const { data: chunks } = await supabase
        .from('pipeline_b_chunks_raw')
        .select('id')
        .in('document_id', docIds);
      
      if (!chunks) return;
      
      const { error } = await supabase
        .from('pipeline_b_agent_knowledge')
        .delete()
        .in('agent_id', agentIds)
        .in('chunk_id', chunks.map(c => c.id));
      
      if (error) throw error;
    } else if (pipeline === 'pipeline_c') {
      const docIds = [...new Set(toDelete.map(x => x.document_id))];
      const agentIds = [...new Set(toDelete.map(x => x.agent_id))];
      
      const { data: chunks } = await supabase
        .from('pipeline_c_chunks_raw')
        .select('id')
        .in('document_id', docIds);
      
      if (!chunks) return;
      
      const { error } = await supabase
        .from('pipeline_c_agent_knowledge')
        .delete()
        .in('agent_id', agentIds)
        .in('chunk_id', chunks.map(c => c.id));
      
      if (error) throw error;
    } else {
      // Legacy pipeline
      const agentIds = [...new Set(toDelete.map(x => x.agent_id))];
      const docIds = [...new Set(toDelete.map(x => x.document_id))];
      
      const { error } = await supabase
        .from('agent_document_links')
        .delete()
        .in('agent_id', agentIds)
        .in('document_id', docIds);
      
      if (error) throw error;
    }
  };

  const processPendingSync = async () => {
    try {
      toast.info("Avvio sincronizzazione documenti pending...");
      const { data, error } = await supabase.functions.invoke('process-sync-queue', {
        body: { batchSize: 100 }
      });
      
      if (error) throw error;
      
      toast.success(`Elaborazione completata: ${data.stats?.successCount || 0} documenti sincronizzati`);
      if (data.stats?.failedCount > 0) {
        toast.warning(`${data.stats.failedCount} documenti falliti`);
      }
    } catch (error) {
      console.error("Errore sync pending:", error);
      toast.error("Errore durante la sincronizzazione");
    }
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
    const OPERATION_TIMEOUT = 120000; // 2 minuti max
    const timeoutId = setTimeout(() => {
      throw new Error("Operazione timeout dopo 2 minuti");
    }, OPERATION_TIMEOUT);

    try {
      setProgressMessage("Caricamento documenti...");
      
      // Step 1: Fetch ALL validated documents from ALL pipelines with pipeline identifier
      const allValidatedDocs: Array<{ id: string; pipeline: string }> = [];
      
      if (folderName) {
        // Folder-based: only legacy pipeline (Pipeline B/C don't use folders)
        let from = 0;
        const pageSize = 1000;
        
        while (true) {
          const { data, error } = await supabase
            .from("knowledge_documents")
            .select("id")
            .eq("processing_status", "ready_for_assignment")
            .eq("validation_status", "validated")
            .like("folder", `${folderName}%`)
            .range(from, from + pageSize - 1);
          
          if (error) throw error;
          if (!data || data.length === 0) break;
          
          allValidatedDocs.push(...data.map(d => ({ id: d.id, pipeline: 'legacy' })));
          console.log(`Fetched ${allValidatedDocs.length} legacy documents so far...`);
          
          if (data.length < pageSize) break;
          from += pageSize;
        }
      } else if (documentIds) {
        // Manual selection: fetch from ALL pipelines
        const [legacyDocs, pipelineBDocs, pipelineCDocs] = await Promise.all([
          supabase
            .from("knowledge_documents")
            .select("id")
            .in("id", documentIds)
            .eq("processing_status", "ready_for_assignment")
            .eq("validation_status", "validated"),
          supabase
            .from("pipeline_b_documents")
            .select("id")
            .in("id", documentIds)
            .eq("status", "ready"),
          supabase
            .from("pipeline_c_documents")
            .select("id")
            .in("id", documentIds)
            .eq("status", "ready")
        ]);
        
        if (legacyDocs.error) throw legacyDocs.error;
        if (pipelineBDocs.error) throw pipelineBDocs.error;
        if (pipelineCDocs.error) throw pipelineCDocs.error;
        
        allValidatedDocs.push(
          ...(legacyDocs.data || []).map(d => ({ id: d.id, pipeline: 'legacy' })),
          ...(pipelineBDocs.data || []).map(d => ({ id: d.id, pipeline: 'b' })),
          ...(pipelineCDocs.data || []).map(d => ({ id: d.id, pipeline: 'c' }))
        );
        console.log(`Fetched ${legacyDocs.data?.length || 0} legacy + ${pipelineBDocs.data?.length || 0} Pipeline B + ${pipelineCDocs.data?.length || 0} Pipeline C documents`);
      }

      const validatedDocs = allValidatedDocs;
      
      if (!validatedDocs || validatedDocs.length === 0) {
        toast.error("Nessun documento validato trovato");
        setLoading(false);
        return;
      }

      const validatedDocIds = validatedDocs.map(d => d.id);
      
      setProgressMessage("Caricamento assegnazioni esistenti...");
      
      // Step 2: Fetch existing assignments PIPELINE-AWARE
      const assignments: Array<{ agent_id: string; document_id: string }> = [];
      const batchSize = 100;
      
      // Group docs by pipeline
      const docsByPipeline = {
        legacy: validatedDocs.filter(d => d.pipeline === 'legacy').map(d => d.id),
        pipeline_b: validatedDocs.filter(d => d.pipeline === 'b').map(d => d.id),
        pipeline_c: validatedDocs.filter(d => d.pipeline === 'c').map(d => d.id)
      };
      
      console.log(`Fetching assignments - Legacy: ${docsByPipeline.legacy.length}, Pipeline B: ${docsByPipeline.pipeline_b.length}, Pipeline C: ${docsByPipeline.pipeline_c.length}`);
      
      // Fetch assignments for each pipeline separately
      for (const [pipelineType, docIds] of Object.entries(docsByPipeline)) {
        if (docIds.length === 0) continue;
        
        for (let i = 0; i < docIds.length; i += batchSize) {
          const batch = docIds.slice(i, i + batchSize);
          const pipelineAssignments = await getCurrentAssignments(batch, pipelineType as PipelineType);
          assignments.push(...pipelineAssignments);
        }
      }
      
      console.log(`Fetched ${assignments.length} existing assignments across all pipelines`);

      setProgressMessage("Calcolo modifiche...");

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

      // Step 4: Execute deletions PIPELINE-AWARE
      if (toDelete.length > 0) {
        setProgressMessage(`Rimozione ${toDelete.length} assegnazioni...`);
        console.log(`Starting deletion of ${toDelete.length} assignments`);
        
        // Group deletions by pipeline
        const deletesByPipeline: Record<string, typeof toDelete> = {
          legacy: [],
          pipeline_b: [],
          pipeline_c: []
        };
        
        toDelete.forEach(del => {
          const doc = validatedDocs.find(d => d.id === del.document_id);
          if (!doc) return;
          
          const key = doc.pipeline === 'b' ? 'pipeline_b' : doc.pipeline === 'c' ? 'pipeline_c' : 'legacy';
          deletesByPipeline[key].push(del);
        });
        
        // Execute deletions per pipeline
        for (const [pipelineType, items] of Object.entries(deletesByPipeline)) {
          if (items.length === 0) continue;
          
          console.log(`Deleting ${items.length} assignments from ${pipelineType}`);
          await removeAssignments(items, pipelineType as PipelineType);
        }
        
        console.log("Deletions completed successfully");
      }

      // Step 5: Execute insertions PIPELINE-AWARE
      if (toInsert.length > 0) {
        setProgressMessage(`Aggiunta ${toInsert.length} assegnazioni...`);
        console.log(`Starting insertion of ${toInsert.length} assignments`);
        
        // Group insertions by pipeline
        const insertsByPipeline: Record<string, typeof toInsert> = {
          legacy: [],
          pipeline_b: [],
          pipeline_c: []
        };
        
        toInsert.forEach(ins => {
          const doc = validatedDocs.find(d => d.id === ins.document_id);
          if (!doc) return;
          
          const key = doc.pipeline === 'b' ? 'pipeline_b' : doc.pipeline === 'c' ? 'pipeline_c' : 'legacy';
          insertsByPipeline[key].push(ins);
        });
        
        // Execute insertions per pipeline
        for (const [pipelineType, items] of Object.entries(insertsByPipeline)) {
          if (items.length === 0) continue;
          
          console.log(`Inserting ${items.length} assignments for ${pipelineType}`);
          
          if (pipelineType === 'legacy') {
            // Legacy: Insert into agent_document_links
            const insertBatchSize = 500;
            for (let i = 0; i < items.length; i += insertBatchSize) {
              const batch = items.slice(i, i + insertBatchSize);
              const { error } = await supabase
                .from("agent_document_links")
                .insert(batch);
              
              if (error) throw error;
            }
            
            // Mark for background sync
            const docIds = [...new Set(items.map(x => x.document_id))];
            for (let i = 0; i < docIds.length; i += batchSize) {
              const batch = docIds.slice(i, i + batchSize);
              await supabase
                .from("agent_document_links")
                .update({ sync_status: 'pending' })
                .in("document_id", batch)
                .in("agent_id", Array.from(selectedAgentIds));
            }
          } else {
            // Pipeline B/C: Use edge function for each assignment
            for (const item of items) {
              const pipeline = pipelineType === 'pipeline_b' ? 'b' : 'c';
              await supabase.functions.invoke('assign-document-to-agent', {
                body: {
                  agentId: item.agent_id,
                  documentId: item.document_id,
                  pipeline
                }
              });
            }
          }
        }
        
        console.log("Insertions completed successfully");
      }

      setProgressMessage("Finalizzazione...");

      // 🚀 Trigger background sync process
      console.log('[BulkAssign] Triggering background sync for pending documents...');
      try {
        const { error: syncError } = await supabase.functions.invoke('process-sync-queue', {
          body: { batchSize: 50 }
        });

        if (syncError) {
          console.error('[BulkAssign] Failed to start sync process:', syncError);
          toast.error(
            `Documenti assegnati ma la sincronizzazione automatica potrebbe aver fallito. Controlla lo stato.`,
            { duration: 5000 }
          );
        }
      } catch (syncTriggerError) {
        console.error('[BulkAssign] Exception triggering sync:', syncTriggerError);
      }

      toast.success(
        `Assegnati ${validatedDocs.length} documenti a ${selectedAgentIds.size} agenti. Sincronizzazione in background avviata.`,
        { duration: 5000 }
      );
      
      onAssigned();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Assignment error:", error);
      console.error("Error details:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      
      const errorMsg = error.details || error.hint || error.message || "Errore sconosciuto";
      toast.error(`Errore: ${errorMsg}`, { duration: 5000 });
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setProgressMessage("");
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
            <div className="space-y-1">
              <div>
                Documenti pronti: {validatedCount}
                {documentCount > validatedCount && (
                  <span className="text-amber-600 ml-2">
                    ({documentCount - validatedCount} non pronti)
                  </span>
                )}
              </div>
              {processingCount > 0 && (
                <div className="text-blue-600 text-sm flex items-center gap-2">
                  <Clock className="h-3 w-3 animate-pulse" />
                  {processingCount} {processingCount === 1 ? 'documento' : 'documenti'} in elaborazione - riprova tra qualche minuto
                </div>
              )}
            </div>
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

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annulla
          </Button>
          <Button
            variant="secondary"
            onClick={processPendingSync}
            disabled={loading}
          >
            🔄 Processa Pending
          </Button>
          <Button
            onClick={handleAssign}
            disabled={loading || validatedCount === 0 || selectedAgentIds.size === 0}
          >
            {loading ? (progressMessage || "Salvando...") : "Salva Assegnazioni"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
