import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const useDocumentAssignment = () => {
  const [isAssigning, setIsAssigning] = useState(false);

  const assignDocument = async (agentId: string, documentId: string, pipeline: 'a' | 'b' | 'c' = 'a'): Promise<boolean> => {
    setIsAssigning(true);
    try {
      const { data, error } = await supabase.functions.invoke('assign-document-to-agent', {
        body: { agentId, documentId, pipeline }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(data.message || 'Document assigned successfully');
        return true;
      } else {
        toast.error(data?.error || 'Failed to assign document');
        return false;
      }
    } catch (error: any) {
      console.error('Error assigning document:', error);
      toast.error(error.message || 'Failed to assign document');
      return false;
    } finally {
      setIsAssigning(false);
    }
  };

  const unassignDocument = async (agentId: string, documentId: string): Promise<boolean> => {
    try {
      // Usa batch delete per evitare limiti URL con troppi chunk_ids
      // Pipeline A Hybrid - la più comune
      const { data: hybridChunks, error: hybridError } = await supabase
        .from('pipeline_a_hybrid_chunks_raw')
        .select('id')
        .eq('document_id', documentId);
      
      if (hybridError) throw hybridError;
      
      if (hybridChunks && hybridChunks.length > 0) {
        // Delete in batches of 500 to avoid URL length limits
        const batchSize = 500;
        for (let i = 0; i < hybridChunks.length; i += batchSize) {
          const batch = hybridChunks.slice(i, i + batchSize).map(c => c.id);
          const { error: deleteError } = await supabase
            .from('pipeline_a_hybrid_agent_knowledge')
            .delete()
            .eq('agent_id', agentId)
            .in('chunk_id', batch);
          
          if (deleteError) {
            console.error(`Error deleting batch ${i / batchSize}:`, deleteError);
          }
        }
        console.log(`Deleted ${hybridChunks.length} chunks from pipeline_a_hybrid_agent_knowledge`);
      }

      // Pipeline A (legacy)
      const { data: pipelineAChunks } = await supabase
        .from('pipeline_a_chunks_raw')
        .select('id')
        .eq('document_id', documentId);
      
      if (pipelineAChunks && pipelineAChunks.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < pipelineAChunks.length; i += batchSize) {
          const batch = pipelineAChunks.slice(i, i + batchSize).map(c => c.id);
          await supabase
            .from('pipeline_a_agent_knowledge')
            .delete()
            .eq('agent_id', agentId)
            .in('chunk_id', batch);
        }
      }

      // Pipeline B
      const { data: pipelineBChunks } = await supabase
        .from('pipeline_b_chunks_raw')
        .select('id')
        .eq('document_id', documentId);
      
      if (pipelineBChunks && pipelineBChunks.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < pipelineBChunks.length; i += batchSize) {
          const batch = pipelineBChunks.slice(i, i + batchSize).map(c => c.id);
          await supabase
            .from('pipeline_b_agent_knowledge')
            .delete()
            .eq('agent_id', agentId)
            .in('chunk_id', batch);
        }
      }

      // Pipeline C
      const { data: pipelineCChunks } = await supabase
        .from('pipeline_c_chunks_raw')
        .select('id')
        .eq('document_id', documentId);
      
      if (pipelineCChunks && pipelineCChunks.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < pipelineCChunks.length; i += batchSize) {
          const batch = pipelineCChunks.slice(i, i + batchSize).map(c => c.id);
          await supabase
            .from('pipeline_c_agent_knowledge')
            .delete()
            .eq('agent_id', agentId)
            .in('chunk_id', batch);
        }
      }

      toast.success('Documento rimosso con successo');
      return true;
    } catch (error: any) {
      console.error('Error unassigning document:', error);
      toast.error('Errore nella rimozione del documento');
      return false;
    }
  };

  const reprocessDocument = async (documentId: string, pipeline: 'a' | 'b' | 'c' = 'a'): Promise<boolean> => {
    try {
      if (pipeline === 'a') {
        // Pipeline A: Reset status to 'ingested'
        const { error } = await supabase
          .from('pipeline_a_documents')
          .update({ 
            status: 'ingested',
            error_message: null,
            processed_at: null
          })
          .eq('id', documentId);

        if (error) throw error;

        toast.success('Documento Pipeline A ripristinato per riprocessamento');
        return true;
      } else if (pipeline === 'c') {
        // Pipeline C: Reset status to 'ingested'
        const { error } = await supabase
          .from('pipeline_c_documents')
          .update({ 
            status: 'ingested',
            error_message: null,
            processed_at: null
          })
          .eq('id', documentId);

        if (error) throw error;

        toast.success('Documento Pipeline C ripristinato per riprocessamento');
        return true;
      } else if (pipeline === 'b') {
        // Pipeline B: Reset status to 'ingested'
        const { error } = await supabase
          .from('pipeline_b_documents')
          .update({ 
            status: 'ingested',
            error_message: null,
            processed_at: null
          })
          .eq('id', documentId);

        if (error) throw error;

        toast.success('Documento Pipeline B ripristinato per riprocessamento');
        return true;
      } else {
        // Legacy: Use reprocess-pool-document function
        const { data, error } = await supabase.functions.invoke('reprocess-pool-document', {
          body: { documentId }
        });

        if (error) throw error;

        if (data?.success) {
          toast.success('Document reprocessing started');
          return true;
        } else {
          toast.error(data?.error || 'Failed to reprocess document');
          return false;
        }
      }
    } catch (error: any) {
      console.error('Error reprocessing document:', error);
      toast.error(error.message || 'Failed to reprocess document');
      return false;
    }
  };

  return {
    assignDocument,
    unassignDocument,
    reprocessDocument,
    isAssigning
  };
};
