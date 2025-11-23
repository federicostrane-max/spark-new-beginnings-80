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
      // Step 1: Carica tutti i documenti assegnati all'agente
      const { data: links, error: linksError } = await supabase
        .from('agent_document_links')
        .select(`
          id,
          assignment_type,
          created_at,
          document_id,
          knowledge_documents (
            id,
            file_name,
            ai_summary,
            created_at
          )
        `)
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (linksError) throw linksError;
      if (!links || links.length === 0) {
        setDocuments([]);
        return;
      }

      // Step 2: Estrai gli ID dei documenti
      const documentIds = links
        .map(link => link.document_id)
        .filter(Boolean);

      if (documentIds.length === 0) {
        setDocuments([]);
        return;
      }

      // Step 3: Conta i chunks per ogni documento
      // Query semplice: prendi TUTTI i chunks shared pool per questi documenti
      const { data: chunks, error: chunksError } = await supabase
        .from('agent_knowledge')
        .select('pool_document_id')
        .is('agent_id', null)  // Solo shared pool chunks
        .eq('is_active', true)
        .in('pool_document_id', documentIds);

      if (chunksError) throw chunksError;

      // Step 4: Crea mappa dei conteggi
      const chunkCounts = new Map<string, number>();
      chunks?.forEach(chunk => {
        if (chunk.pool_document_id) {
          chunkCounts.set(
            chunk.pool_document_id,
            (chunkCounts.get(chunk.pool_document_id) || 0) + 1
          );
        }
      });

      // Step 5: Costruisci l'array dei documenti con stato
      const docsWithStatus: DocumentSyncStatus[] = links
        .filter(link => link.knowledge_documents)
        .map(link => {
          const doc = link.knowledge_documents as any;
          const chunkCount = chunkCounts.get(doc.id) || 0;
          
          return {
            id: doc.id,
            file_name: doc.file_name,
            ai_summary: doc.ai_summary,
            created_at: doc.created_at,
            assignment_type: link.assignment_type,
            syncStatus: chunkCount > 0 ? 'synced' : 'missing',
            chunkCount,
          };
        });

      setDocuments(docsWithStatus);
    } catch (err) {
      console.error('Error loading documents:', err);
      setError(err instanceof Error ? err.message : 'Errore sconosciuto');
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  const syncDocument = useCallback(async (documentId: string) => {
    try {
      // Aggiorna lo stato del documento a "checking"
      setDocuments(prev =>
        prev.map(doc =>
          doc.id === documentId
            ? { ...doc, syncStatus: 'checking' as const }
            : doc
        )
      );

      // Chiama la funzione di sincronizzazione
      const { error } = await supabase.functions.invoke('sync-pool-document', {
        body: { documentId, agentId },
      });

      if (error) throw error;

      // Ricarica i documenti per aggiornare lo stato
      await loadDocuments();
    } catch (err) {
      console.error('Error syncing document:', err);
      
      // Ripristina lo stato precedente in caso di errore
      setDocuments(prev =>
        prev.map(doc =>
          doc.id === documentId
            ? { ...doc, syncStatus: 'missing' as const }
            : doc
        )
      );
      
      throw err;
    }
  }, [agentId, loadDocuments]);

  const syncAllMissing = useCallback(async () => {
    const missingDocs = documents.filter(doc => doc.syncStatus === 'missing');
    
    for (const doc of missingDocs) {
      try {
        await syncDocument(doc.id);
      } catch (err) {
        console.error(`Failed to sync ${doc.file_name}:`, err);
      }
    }
  }, [documents, syncDocument]);

  return {
    documents,
    isLoading,
    error,
    loadDocuments,
    syncDocument,
    syncAllMissing,
  };
};
