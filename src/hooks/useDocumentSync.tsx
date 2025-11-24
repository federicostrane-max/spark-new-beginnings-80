import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface DocumentSyncStatus {
  id: string;
  file_name: string;
  ai_summary: string | null;
  created_at: string;
  assignment_type: string;
  syncStatus: 'synced' | 'missing' | 'checking';
  chunkCount: number;
}

export const useDocumentSync = (agentId: string) => {
  const [documents, setDocuments] = useState<DocumentSyncStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Use new RPC to get sync status
      const { data: syncStatuses, error: rpcError } = await supabase
        .rpc('get_agent_sync_status', { p_agent_id: agentId });

      if (rpcError) throw rpcError;

      // Transform RPC results to match our interface
      const docsWithStatus: DocumentSyncStatus[] = (syncStatuses || []).map((status: any) => ({
        id: status.document_id,
        file_name: status.file_name,
        ai_summary: null,
        created_at: new Date().toISOString(),
        assignment_type: 'manual',
        syncStatus: status.chunk_count > 0 ? 'synced' : 'missing',
        chunkCount: status.chunk_count || 0,
      }));

      setDocuments(docsWithStatus);
    } catch (err) {
      console.error('Error loading documents:', err);
      setError(err instanceof Error ? err.message : 'Errore sconosciuto');
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  // Sync functions removed - synchronization now handled by background cron job
  // Documents are automatically synced via process-document-sync edge function

  return {
    documents,
    isLoading,
    error,
    loadDocuments,
  };
};
