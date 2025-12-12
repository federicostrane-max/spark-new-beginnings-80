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
  pipeline?: 'a' | 'b' | 'c' | 'a-hybrid';
}

type PipelineType = 'pipeline_a' | 'pipeline_a_hybrid' | 'pipeline_b' | 'pipeline_c';

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
    console.log('[BulkAssign] countDocuments called with:', {
      documentIds: documentIds?.length,
      folderName,
      documentIdsPreview: documentIds?.slice(0, 5)
    });

    try {
      if (folderName) {
        // Folder-based: query ALL pipelines (A, A-Hybrid, B, C)
        const [
          pipelineATotal, pipelineAHybridTotal, pipelineBTotal, pipelineCTotal,
          pipelineAValid, pipelineAHybridValid, pipelineBValid, pipelineCValid
        ] = await Promise.all([
          // Pipeline A total (with folder)
          supabase
            .from("pipeline_a_documents")
            .select("id", { count: 'exact', head: true })
            .like("folder", `${folderName}%`),
          // Pipeline A-Hybrid total (with folder)
          supabase
            .from("pipeline_a_hybrid_documents")
            .select("id", { count: 'exact', head: true })
            .like("folder", `${folderName}%`),
          // Pipeline B total (with folder)
          supabase
            .from("pipeline_b_documents")
            .select("id", { count: 'exact', head: true })
            .like("folder", `${folderName}%`),
          // Pipeline C total (with folder)
          supabase
            .from("pipeline_c_documents")
            .select("id", { count: 'exact', head: true })
            .like("folder", `${folderName}%`),
          // Pipeline A valid
          supabase
            .from("pipeline_a_documents")
            .select("id", { count: 'exact', head: true })
            .like("folder", `${folderName}%`)
            .eq("status", "ready"),
          // Pipeline A-Hybrid valid
          supabase
            .from("pipeline_a_hybrid_documents")
            .select("id", { count: 'exact', head: true })
            .like("folder", `${folderName}%`)
            .eq("status", "ready"),
          // Pipeline B valid
          supabase
            .from("pipeline_b_documents")
            .select("id", { count: 'exact', head: true })
            .like("folder", `${folderName}%`)
            .eq("status", "ready"),
          // Pipeline C valid
          supabase
            .from("pipeline_c_documents")
            .select("id", { count: 'exact', head: true })
            .like("folder", `${folderName}%`)
            .eq("status", "ready")
        ]);

        const totalCount = (pipelineATotal.count || 0) + (pipelineAHybridTotal.count || 0) + (pipelineBTotal.count || 0) + (pipelineCTotal.count || 0);
        const validCount = (pipelineAValid.count || 0) + (pipelineAHybridValid.count || 0) + (pipelineBValid.count || 0) + (pipelineCValid.count || 0);
        
        console.log('[BulkAssign] Folder mode counts:', {
          folderName,
          pipelineATotal: pipelineATotal.count,
          pipelineBTotal: pipelineBTotal.count,
          pipelineCTotal: pipelineCTotal.count,
          totalCount,
          validCount
        });

        setDocumentCount(totalCount);
        setValidatedCount(validCount);
        setProcessingCount(0); // Folder mode doesn't track processing
      } else if (documentIds && documentIds.length > 0) {
        // Manual selection: check ALL pipelines (A, A-Hybrid, B, C)
        const [
          pipelineATotal, pipelineAHybridTotal, pipelineBTotal, pipelineCTotal,
          pipelineAValid, pipelineAHybridValid, pipelineBValid, pipelineCValid,
          pipelineAProcessing, pipelineAHybridProcessing, pipelineBProcessing, pipelineCProcessing
        ] = await Promise.all([
          // Pipeline A total
          supabase
            .from("pipeline_a_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds),
          // Pipeline A-Hybrid total
          supabase
            .from("pipeline_a_hybrid_documents")
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
          // Pipeline A-Hybrid valid
          supabase
            .from("pipeline_a_hybrid_documents")
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
            .in("status", ["ingested", "processing", "chunked"]),
          // Pipeline A-Hybrid processing
          supabase
            .from("pipeline_a_hybrid_documents")
            .select("id", { count: 'exact', head: true })
            .in("id", documentIds)
            .in("status", ["ingested", "processing", "chunked"]),
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
        
        console.log('[BulkAssign] Query results:', {
          pipelineATotal: pipelineATotal.count,
          pipelineAHybridTotal: pipelineAHybridTotal.count,
          pipelineBTotal: pipelineBTotal.count,
          pipelineCTotal: pipelineCTotal.count,
          pipelineAValid: pipelineAValid.count,
          pipelineAHybridValid: pipelineAHybridValid.count,
          pipelineBValid: pipelineBValid.count,
          pipelineCValid: pipelineCValid.count,
          pipelineAProcessing: pipelineAProcessing.count,
          pipelineAHybridProcessing: pipelineAHybridProcessing.count,
          pipelineBProcessing: pipelineBProcessing.count,
          pipelineCProcessing: pipelineCProcessing.count
        });

        const totalCount = (pipelineATotal.count || 0) + (pipelineAHybridTotal.count || 0) + (pipelineBTotal.count || 0) + (pipelineCTotal.count || 0);
        const validCount = (pipelineAValid.count || 0) + (pipelineAHybridValid.count || 0) + (pipelineBValid.count || 0) + (pipelineCValid.count || 0);
        const processingCount = (pipelineAProcessing.count || 0) + (pipelineAHybridProcessing.count || 0) + (pipelineBProcessing.count || 0) + (pipelineCProcessing.count || 0);
        
        console.log('[BulkAssign] Calculated counts:', {
          totalCount,
          validCount,
          processingCount
        });

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

  // Auto-refresh when documents are processing + Realtime updates
  useEffect(() => {
    if (!open) return;

    // Polling as fallback
    const interval = processingCount > 0 ? setInterval(() => {
      console.log('[BulkAssignDocumentDialog] 🔄 Auto-refresh: checking for ready documents...');
      countDocuments();
    }, 5000) : null;

    // Realtime subscription for Pipeline A documents
    const channelA = supabase
      .channel('bulk-assign-pipeline-a-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pipeline_a_documents'
        },
        (payload) => {
          console.log('[BulkAssignDocumentDialog] 🔔 Pipeline A document updated:', payload.new);
          countDocuments();
        }
      )
      .subscribe((status) => {
        console.log('[BulkAssignDocumentDialog] 📡 Pipeline A channel status:', status);
      });

    // Realtime subscription for Pipeline B documents
    const channelB = supabase
      .channel('bulk-assign-pipeline-b-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pipeline_b_documents'
        },
        (payload) => {
          console.log('[BulkAssignDocumentDialog] 🔔 Pipeline B document updated:', payload.new);
          countDocuments();
        }
      )
      .subscribe((status) => {
        console.log('[BulkAssignDocumentDialog] 📡 Pipeline B channel status:', status);
      });

    // Realtime subscription for Pipeline A-Hybrid documents
    const channelAHybrid = supabase
      .channel('bulk-assign-pipeline-a-hybrid-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pipeline_a_hybrid_documents'
        },
        (payload) => {
          console.log('[BulkAssignDocumentDialog] 🔔 Pipeline A-Hybrid document updated:', payload.new);
          countDocuments();
        }
      )
      .subscribe((status) => {
        console.log('[BulkAssignDocumentDialog] 📡 Pipeline A-Hybrid channel status:', status);
      });

    // Realtime subscription for Pipeline C documents
    const channelC = supabase
      .channel('bulk-assign-pipeline-c-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pipeline_c_documents'
        },
        (payload) => {
          console.log('[BulkAssignDocumentDialog] 🔔 Pipeline C document updated:', payload.new);
          countDocuments();
        }
      )
      .subscribe((status) => {
        console.log('[BulkAssignDocumentDialog] 📡 Pipeline C channel status:', status);
      });

    return () => {
      if (interval) clearInterval(interval);
      supabase.removeChannel(channelA);
      supabase.removeChannel(channelB);
      supabase.removeChannel(channelAHybrid);
      supabase.removeChannel(channelC);
    };
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
        // Get assignments from all pipelines
        const allAssignments: Array<{ agent_id: string; document_id: string }> = [];
        
        // Pipeline A
        const { data: aChunks } = await supabase.from('pipeline_a_chunks_raw').select('id, document_id').in('document_id', documentIds);
        if (aChunks && aChunks.length > 0) {
          const { data: aAssignments } = await supabase.from('pipeline_a_agent_knowledge').select('agent_id, chunk_id').in('chunk_id', aChunks.map(c => c.id));
          const chunkToDoc = new Map(aChunks.map(c => [c.id, c.document_id]));
          allAssignments.push(...(aAssignments || []).map(a => ({ agent_id: a.agent_id, document_id: chunkToDoc.get(a.chunk_id)! })));
        }
        
        // Pipeline A-Hybrid
        const { data: aHybridChunks } = await supabase.from('pipeline_a_hybrid_chunks_raw').select('id, document_id').in('document_id', documentIds);
        if (aHybridChunks && aHybridChunks.length > 0) {
          const { data: aHybridAssignments } = await supabase.from('pipeline_a_hybrid_agent_knowledge').select('agent_id, chunk_id').in('chunk_id', aHybridChunks.map(c => c.id));
          const chunkToDoc = new Map(aHybridChunks.map(c => [c.id, c.document_id]));
          allAssignments.push(...(aHybridAssignments || []).map(a => ({ agent_id: a.agent_id, document_id: chunkToDoc.get(a.chunk_id)! })));
        }
        
        // Pipeline B
        const { data: bChunks } = await supabase.from('pipeline_b_chunks_raw').select('id, document_id').in('document_id', documentIds);
        if (bChunks && bChunks.length > 0) {
          const { data: bAssignments } = await supabase.from('pipeline_b_agent_knowledge').select('agent_id, chunk_id').in('chunk_id', bChunks.map(c => c.id));
          const chunkToDoc = new Map(bChunks.map(c => [c.id, c.document_id]));
          allAssignments.push(...(bAssignments || []).map(a => ({ agent_id: a.agent_id, document_id: chunkToDoc.get(a.chunk_id)! })));
        }
        
        // Pipeline C
        const { data: cChunks } = await supabase.from('pipeline_c_chunks_raw').select('id, document_id').in('document_id', documentIds);
        if (cChunks && cChunks.length > 0) {
          const { data: cAssignments } = await supabase.from('pipeline_c_agent_knowledge').select('agent_id, chunk_id').in('chunk_id', cChunks.map(c => c.id));
          const chunkToDoc = new Map(cChunks.map(c => [c.id, c.document_id]));
          allAssignments.push(...(cAssignments || []).map(a => ({ agent_id: a.agent_id, document_id: chunkToDoc.get(a.chunk_id)! })));
        }

        // Count how many documents each agent is assigned to
        const agentCounts = new Map<string, number>();
        allAssignments.forEach(link => {
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

  // Pipeline-aware helper: Get existing assignments (with batching to avoid URL length limits)
  const getCurrentAssignments = async (documentIds: string[], pipeline: PipelineType) => {
    const BATCH_SIZE = 50; // Avoid URL length limits
    const results: Array<{ agent_id: string; document_id: string }> = [];
    
    // Helper to fetch and process in batches
    const fetchBatched = async (
      fetchChunks: (ids: string[]) => Promise<{ id: string; document_id: string }[]>,
      fetchAssignments: (chunkIds: string[]) => Promise<{ agent_id: string; chunk_id: string }[]>
    ) => {
      for (let i = 0; i < documentIds.length; i += BATCH_SIZE) {
        const batchDocIds = documentIds.slice(i, i + BATCH_SIZE);
        const chunks = await fetchChunks(batchDocIds);
        
        if (chunks.length === 0) continue;
        
        const chunkIds = chunks.map(c => c.id);
        const chunkToDoc = new Map(chunks.map(c => [c.id, c.document_id]));
        
        // Also batch chunk IDs
        for (let j = 0; j < chunkIds.length; j += BATCH_SIZE) {
          const batchChunkIds = chunkIds.slice(j, j + BATCH_SIZE);
          const assignments = await fetchAssignments(batchChunkIds);
          
          results.push(...assignments.map(a => ({
            agent_id: a.agent_id,
            document_id: chunkToDoc.get(a.chunk_id)!
          })));
        }
      }
    };

    if (pipeline === 'pipeline_a') {
      await fetchBatched(
        async (ids) => {
          const { data } = await supabase.from('pipeline_a_chunks_raw').select('id, document_id').in('document_id', ids);
          return data || [];
        },
        async (chunkIds) => {
          const { data } = await supabase.from('pipeline_a_agent_knowledge').select('agent_id, chunk_id').in('chunk_id', chunkIds);
          return data || [];
        }
      );
    } else if (pipeline === 'pipeline_a_hybrid') {
      await fetchBatched(
        async (ids) => {
          const { data } = await supabase.from('pipeline_a_hybrid_chunks_raw').select('id, document_id').in('document_id', ids);
          return data || [];
        },
        async (chunkIds) => {
          const { data } = await supabase.from('pipeline_a_hybrid_agent_knowledge').select('agent_id, chunk_id').in('chunk_id', chunkIds);
          return data || [];
        }
      );
    } else if (pipeline === 'pipeline_b') {
      await fetchBatched(
        async (ids) => {
          const { data } = await supabase.from('pipeline_b_chunks_raw').select('id, document_id').in('document_id', ids);
          return data || [];
        },
        async (chunkIds) => {
          const { data } = await supabase.from('pipeline_b_agent_knowledge').select('agent_id, chunk_id').in('chunk_id', chunkIds);
          return data || [];
        }
      );
    } else {
      await fetchBatched(
        async (ids) => {
          const { data } = await supabase.from('pipeline_c_chunks_raw').select('id, document_id').in('document_id', ids);
          return data || [];
        },
        async (chunkIds) => {
          const { data } = await supabase.from('pipeline_c_agent_knowledge').select('agent_id, chunk_id').in('chunk_id', chunkIds);
          return data || [];
        }
      );
    }
    
    return results;
  };

  // Pipeline-aware helper: Remove assignments (with batching)
  const removeAssignments = async (toDelete: Array<{ agent_id: string; document_id: string }>, pipeline: PipelineType) => {
    const BATCH_SIZE = 50;
    const docIds = [...new Set(toDelete.map(x => x.document_id))];
    const agentIds = [...new Set(toDelete.map(x => x.agent_id))];
    
    const deleteFromPipeline = async (
      fetchChunks: (ids: string[]) => Promise<{ id: string }[]>,
      deleteAssignments: (chunkIds: string[]) => Promise<void>
    ) => {
      const allChunkIds: string[] = [];
      
      // Fetch chunks in batches
      for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
        const batchDocIds = docIds.slice(i, i + BATCH_SIZE);
        const chunks = await fetchChunks(batchDocIds);
        allChunkIds.push(...chunks.map(c => c.id));
      }
      
      if (allChunkIds.length === 0) return;
      
      // Delete in batches
      for (let i = 0; i < allChunkIds.length; i += BATCH_SIZE) {
        const batchChunkIds = allChunkIds.slice(i, i + BATCH_SIZE);
        await deleteAssignments(batchChunkIds);
      }
    };
    
    if (pipeline === 'pipeline_a') {
      await deleteFromPipeline(
        async (ids) => {
          const { data } = await supabase.from('pipeline_a_chunks_raw').select('id').in('document_id', ids);
          return data || [];
        },
        async (chunkIds) => {
          const { error } = await supabase.from('pipeline_a_agent_knowledge').delete().in('agent_id', agentIds).in('chunk_id', chunkIds);
          if (error) throw error;
        }
      );
    } else if (pipeline === 'pipeline_a_hybrid') {
      await deleteFromPipeline(
        async (ids) => {
          const { data } = await supabase.from('pipeline_a_hybrid_chunks_raw').select('id').in('document_id', ids);
          return data || [];
        },
        async (chunkIds) => {
          const { error } = await supabase.from('pipeline_a_hybrid_agent_knowledge').delete().in('agent_id', agentIds).in('chunk_id', chunkIds);
          if (error) throw error;
        }
      );
    } else if (pipeline === 'pipeline_b') {
      await deleteFromPipeline(
        async (ids) => {
          const { data } = await supabase.from('pipeline_b_chunks_raw').select('id').in('document_id', ids);
          return data || [];
        },
        async (chunkIds) => {
          const { error } = await supabase.from('pipeline_b_agent_knowledge').delete().in('agent_id', agentIds).in('chunk_id', chunkIds);
          if (error) throw error;
        }
      );
    } else {
      await deleteFromPipeline(
        async (ids) => {
          const { data } = await supabase.from('pipeline_c_chunks_raw').select('id').in('document_id', ids);
          return data || [];
        },
        async (chunkIds) => {
          const { error } = await supabase.from('pipeline_c_agent_knowledge').delete().in('agent_id', agentIds).in('chunk_id', chunkIds);
          if (error) throw error;
        }
      );
    }
  };

  const processPendingSync = async () => {
    // Legacy function removed - process-sync-queue no longer exists
    // Document syncing is now handled automatically by Pipeline A/B/C architecture
    console.log('[BulkAssign] Legacy sync function removed - syncing handled by pipelines');
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
        // Folder-based: fetch from ALL pipelines
        const [pipelineADocs, pipelineAHybridDocs, pipelineBDocs, pipelineCDocs] = await Promise.all([
          supabase
            .from("pipeline_a_documents")
            .select("id")
            .like("folder", `${folderName}%`)
            .eq("status", "ready"),
          supabase
            .from("pipeline_a_hybrid_documents")
            .select("id")
            .like("folder", `${folderName}%`)
            .eq("status", "ready"),
          supabase
            .from("pipeline_b_documents")
            .select("id")
            .like("folder", `${folderName}%`)
            .eq("status", "ready"),
          supabase
            .from("pipeline_c_documents")
            .select("id")
            .like("folder", `${folderName}%`)
            .eq("status", "ready")
        ]);
        
        if (pipelineADocs.error) throw pipelineADocs.error;
        if (pipelineAHybridDocs.error) throw pipelineAHybridDocs.error;
        if (pipelineBDocs.error) throw pipelineBDocs.error;
        if (pipelineCDocs.error) throw pipelineCDocs.error;
        
        allValidatedDocs.push(
          ...(pipelineADocs.data || []).map(d => ({ id: d.id, pipeline: 'a' })),
          ...(pipelineAHybridDocs.data || []).map(d => ({ id: d.id, pipeline: 'a-hybrid' })),
          ...(pipelineBDocs.data || []).map(d => ({ id: d.id, pipeline: 'b' })),
          ...(pipelineCDocs.data || []).map(d => ({ id: d.id, pipeline: 'c' }))
        );
        
        console.log(`Folder documents: Pipeline A: ${pipelineADocs.data?.length || 0}, A-Hybrid: ${pipelineAHybridDocs.data?.length || 0}, B: ${pipelineBDocs.data?.length || 0}, C: ${pipelineCDocs.data?.length || 0}`);
      } else if (documentIds) {
        // Manual selection: fetch from ALL pipelines
        const [pipelineADocs, pipelineAHybridDocs, pipelineBDocs, pipelineCDocs] = await Promise.all([
          supabase
            .from("pipeline_a_documents")
            .select("id")
            .in("id", documentIds)
            .eq("status", "ready"),
          supabase
            .from("pipeline_a_hybrid_documents")
            .select("id")
            .in("id", documentIds)
            .eq("status", "ready"),
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
        
        if (pipelineADocs.error) throw pipelineADocs.error;
        if (pipelineAHybridDocs.error) throw pipelineAHybridDocs.error;
        if (pipelineBDocs.error) throw pipelineBDocs.error;
        if (pipelineCDocs.error) throw pipelineCDocs.error;
        
        allValidatedDocs.push(
          ...(pipelineADocs.data || []).map(d => ({ id: d.id, pipeline: 'a' })),
          ...(pipelineAHybridDocs.data || []).map(d => ({ id: d.id, pipeline: 'a-hybrid' })),
          ...(pipelineBDocs.data || []).map(d => ({ id: d.id, pipeline: 'b' })),
          ...(pipelineCDocs.data || []).map(d => ({ id: d.id, pipeline: 'c' }))
        );
        console.log(`Manual selection: Pipeline A: ${pipelineADocs.data?.length || 0}, A-Hybrid: ${pipelineAHybridDocs.data?.length || 0}, B: ${pipelineBDocs.data?.length || 0}, C: ${pipelineCDocs.data?.length || 0}`);
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
        pipeline_a: validatedDocs.filter(d => d.pipeline === 'a').map(d => d.id),
        pipeline_a_hybrid: validatedDocs.filter(d => d.pipeline === 'a-hybrid').map(d => d.id),
        pipeline_b: validatedDocs.filter(d => d.pipeline === 'b').map(d => d.id),
        pipeline_c: validatedDocs.filter(d => d.pipeline === 'c').map(d => d.id)
      };
      
      console.log(`Fetching assignments - Pipeline A: ${docsByPipeline.pipeline_a.length}, A-Hybrid: ${docsByPipeline.pipeline_a_hybrid.length}, B: ${docsByPipeline.pipeline_b.length}, C: ${docsByPipeline.pipeline_c.length}`);
      
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
          pipeline_a: [],
          pipeline_a_hybrid: [],
          pipeline_b: [],
          pipeline_c: []
        };
        
        toDelete.forEach(del => {
          const doc = validatedDocs.find(d => d.id === del.document_id);
          if (!doc) return;
          
          const key = doc.pipeline === 'a' ? 'pipeline_a' : doc.pipeline === 'a-hybrid' ? 'pipeline_a_hybrid' : doc.pipeline === 'b' ? 'pipeline_b' : 'pipeline_c';
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
          pipeline_a: [],
          pipeline_a_hybrid: [],
          pipeline_b: [],
          pipeline_c: []
        };
        
        toInsert.forEach(ins => {
          const doc = validatedDocs.find(d => d.id === ins.document_id);
          if (!doc) return;
          
          const key = doc.pipeline === 'a' ? 'pipeline_a' : doc.pipeline === 'a-hybrid' ? 'pipeline_a_hybrid' : doc.pipeline === 'b' ? 'pipeline_b' : 'pipeline_c';
          insertsByPipeline[key].push(ins);
        });
        
        // Execute insertions per pipeline using BULK assignment (background processing)
        for (const [pipelineType, items] of Object.entries(insertsByPipeline)) {
          if (items.length === 0) continue;
          
          console.log(`Bulk inserting ${items.length} assignments for ${pipelineType}`);
          
          // Group by agent for bulk processing
          const itemsByAgent = items.reduce((acc, item) => {
            if (!acc[item.agent_id]) acc[item.agent_id] = [];
            acc[item.agent_id].push(item.document_id);
            return acc;
          }, {} as Record<string, string[]>);
          
          const pipeline = pipelineType === 'pipeline_a' ? 'a' : pipelineType === 'pipeline_a_hybrid' ? 'a-hybrid' : pipelineType === 'pipeline_b' ? 'b' : 'c';
          
          // Single bulk call per agent - processes in background even if user closes dialog
          for (const [agentId, docIds] of Object.entries(itemsByAgent)) {
            console.log(`Bulk assign ${docIds.length} docs to agent ${agentId} (${pipeline})`);
            await supabase.functions.invoke('bulk-assign-documents', {
              body: {
                agentId,
                documentIds: docIds,
                pipeline
              }
            });
          }
        }
        
        console.log("Insertions completed successfully");
      }

      setProgressMessage("Finalizzazione...");

      // Legacy sync queue removed - Pipeline A/B/C handle syncing automatically
      console.log('[BulkAssign] Document assignment complete - syncing handled by pipelines');

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
