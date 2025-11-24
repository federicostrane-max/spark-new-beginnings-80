import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const useDocumentAssignment = () => {
  const [isAssigning, setIsAssigning] = useState(false);

  const assignDocument = async (agentId: string, documentId: string): Promise<boolean> => {
    setIsAssigning(true);
    try {
      const { data, error } = await supabase.functions.invoke('assign-document-to-agent', {
        body: { agentId, documentId }
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
      const { error } = await supabase
        .from('agent_document_links')
        .delete()
        .eq('agent_id', agentId)
        .eq('document_id', documentId);

      if (error) throw error;

      toast.success('Document unassigned successfully');
      return true;
    } catch (error: any) {
      console.error('Error unassigning document:', error);
      toast.error('Failed to unassign document');
      return false;
    }
  };

  const reprocessDocument = async (documentId: string): Promise<boolean> => {
    try {
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
