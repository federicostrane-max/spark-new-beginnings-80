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

  const reprocessDocument = async (documentId: string, pipeline: 'a' | 'b' | 'c' = 'a'): Promise<boolean> => {
    try {
      if (pipeline === 'a') {
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
      }
      
      return false;
    } catch (error: any) {
      console.error('Error reprocessing document:', error);
      toast.error(error.message || 'Failed to reprocess document');
      return false;
    }
  };

  return {
    assignDocument,
    reprocessDocument,
    isAssigning
  };
};
