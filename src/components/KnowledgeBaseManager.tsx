import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, FileText, Plus, RefreshCw, CheckCircle2, AlertCircle, Download, XCircle, Settings, Search } from "lucide-react";
import { logger } from "@/lib/logger";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KnowledgeAlignmentDashboard } from "./KnowledgeAlignmentDashboard";

interface KnowledgeDocument {
  id: string;
  file_name: string;
  ai_summary: string | null;
  created_at: string;
  assignment_type: string;
  link_id: string;
  syncStatus?: 'synced' | 'missing' | 'checking' | 'storage_missing';
  chunkCount?: number;
  expectedChunks?: number;
}

interface KnowledgeBaseManagerProps {
  agentId: string;
  agentName: string;
  onDocsUpdated?: () => void;
}

interface PoolDocument {
  id: string;
  file_name: string;
  ai_summary: string | null;
  created_at: string;
  isAssigned: boolean;
  similarity?: number;
}

export const KnowledgeBaseManager = ({ agentId, agentName, onDocsUpdated }: KnowledgeBaseManagerProps) => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [poolDocuments, setPoolDocuments] = useState<PoolDocument[]>([]);
  const [loadingPool, setLoadingPool] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [syncStatuses, setSyncStatuses] = useState<Map<string, 'synced' | 'syncing' | 'error'>>(new Map());
  const [hasTriedQuickSync, setHasTriedQuickSync] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [displayedDocuments, setDisplayedDocuments] = useState<PoolDocument[]>([]);
  const [removingLinkId, setRemovingLinkId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    console.log('🔵 KnowledgeBaseManager mounted, agentId:', agentId);
    loadDocuments();
  }, [agentId]);

  const loadDocuments = async () => {
    console.log('🔵 loadDocuments called for agent:', agentId);
    logger.info('knowledge-base', 'Loading assigned documents', { agentId }, { agentId });
    try {
      setLoading(true);
      
      // Query documents assigned to this agent via agent_document_links
      const { data, error } = await supabase
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

      if (error) {
        logger.error('knowledge-base', 'Failed to load assigned documents', error, { agentId });
        throw error;
      }

      // Transform data to flat structure
      const transformedData: KnowledgeDocument[] = (data || [])
        .filter(link => link.knowledge_documents)
        .map(link => ({
          id: (link.knowledge_documents as any).id,
          file_name: (link.knowledge_documents as any).file_name,
          ai_summary: (link.knowledge_documents as any).ai_summary,
          created_at: (link.knowledge_documents as any).created_at,
          assignment_type: link.assignment_type,
          link_id: link.id,
          syncStatus: 'checking',
          chunkCount: 0,
        }));

      logger.success('knowledge-base', `Loaded ${transformedData.length} assigned documents`, undefined, { agentId });
      setDocuments(transformedData);
      console.log('✅ After setDocuments, transformedData count:', transformedData.length);

      // Check sync status for each document
      if (transformedData.length > 0) {
        // Small delay to ensure database writes have propagated
        await new Promise(resolve => setTimeout(resolve, 500));
        logger.info('document-sync', `Calling checkSyncStatuses for ${transformedData.length} documents`, undefined, { agentId });
        console.log('🔄 About to call checkSyncStatuses...');
        // Use await to ensure sync status is loaded before UI becomes interactive
        await checkSyncStatuses(transformedData);
        console.log('✅ checkSyncStatuses completed');
      }
    } catch (error: any) {
      logger.error('knowledge-base', 'Error loading assigned documents', error, { agentId });
    } finally {
      setLoading(false);
    }
  };

  // Direct database query fallback for sync status
  const checkSyncStatusesDirect = async (docs: KnowledgeDocument[]) => {
    console.log('🔍 [checkSyncStatusesDirect] START - docs count:', docs.length);
    
    try {
      const docIds = docs.map(d => d.id);
      console.log('🔍 Looking for chunks with IDs:', docIds.slice(0, 3));
      
      // Query chunk counts directly from agent_knowledge
      const { data: chunkCounts, error } = await supabase
        .from('agent_knowledge')
        .select('pool_document_id')
        .eq('agent_id', agentId)
        .eq('is_active', true)
        .in('pool_document_id', docIds);

      if (error) {
        console.error('❌ Error querying agent_knowledge:', error);
        throw error;
      }

      console.log('✅ Found chunks:', chunkCounts?.length);

      // Count chunks per document
      const chunkCountMap = new Map<string, number>();
      chunkCounts?.forEach(chunk => {
        if (chunk.pool_document_id) {
          chunkCountMap.set(
            chunk.pool_document_id,
            (chunkCountMap.get(chunk.pool_document_id) || 0) + 1
          );
        }
      });

      console.log('📊 Chunk count map size:', chunkCountMap.size);

      // Update documents with correct chunk counts
      const updatedDocs = docs.map(doc => {
        const chunkCount = chunkCountMap.get(doc.id) || 0;
        console.log(`  - ${doc.file_name}: ${chunkCount} chunks`);
        return {
          ...doc,
          syncStatus: (chunkCount > 0 ? 'synced' : 'missing') as 'synced' | 'missing',
          chunkCount,
          expectedChunks: chunkCount,
        };
      });

      console.log('🔄 Calling setDocuments with', updatedDocs.length, 'docs');
      setDocuments([...updatedDocs]); // Force new array reference
      console.log('✅ setDocuments called');

      const missingCount = updatedDocs.filter(d => d.syncStatus === 'missing').length;
      console.log(`✅ Final: ${updatedDocs.length - missingCount} synced, ${missingCount} missing`);

      // Reset quick sync flag only if all documents are synced
      const allSynced = updatedDocs.every(doc => doc.syncStatus === 'synced');
      if (allSynced) {
        setHasTriedQuickSync(false);
      }

      // Notify parent component about doc updates
      if (onDocsUpdated) {
        onDocsUpdated();
      }
    } catch (error) {
      logger.error('document-sync', 'Error in direct database query', error, { agentId });
      toast.error('Errore nel caricamento dello stato dei documenti');
    }
  };

  const checkSyncStatuses = async (docs: KnowledgeDocument[]) => {
    // ALWAYS use direct database query - it's faster and more reliable than edge function
    logger.info('document-sync', `Checking sync status for ${docs.length} documents using direct database query`, undefined, { agentId });
    await checkSyncStatusesDirect(docs);
  };


  const handleSyncAllMissing = async (forceRedownload = false) => {
    // Include both 'missing' and 'checking' documents (checking means status wasn't loaded correctly)
    const missingDocs = documents.filter(doc => 
      doc.syncStatus === 'missing' || doc.syncStatus === 'checking' || (doc.chunkCount || 0) === 0
    );
    
    if (missingDocs.length === 0) {
      toast.info('Nessun documento da sincronizzare');
      return;
    }
    
    logger.info('document-sync', `Starting sync for ${missingDocs.length} documents`, undefined, { agentId });

    let successCount = 0;
    let failedDocs: Array<{doc: typeof missingDocs[0], error: string}> = [];

    // STEP 1: Quick resync (only if not forced and not already tried)
    if (!forceRedownload && !hasTriedQuickSync) {
      logger.info('document-sync', `Quick resync check for ${missingDocs.length} documents`, undefined, { agentId });
      toast.info(`Verifica rapida di ${missingDocs.length} documenti...`, { duration: 3000 });
      
      for (let i = 0; i < missingDocs.length; i++) {
        const doc = missingDocs[i];
        
        try {
          const { data: existingChunks } = await supabase
            .from('agent_knowledge')
            .select('id')
            .eq('agent_id', agentId)
            .eq('pool_document_id', doc.id);

          if (existingChunks && existingChunks.length > 0) {
            logger.success('document-sync', `Document already synced: ${doc.file_name}`, 
              { chunkCount: existingChunks.length }, 
              { agentId, documentId: doc.id }
            );
            setDocuments(prev => prev.map(d => 
              d.id === doc.id 
                ? { ...d, syncStatus: 'synced' as const, chunkCount: existingChunks.length }
                : d
            ));
            successCount++;
          } else {
            logger.warning('document-sync', `Document has no chunks: ${doc.file_name}`, undefined, 
              { agentId, documentId: doc.id }
            );
            failedDocs.push({ doc, error: 'no_chunks' });
          }
        } catch (error) {
          logger.error('document-sync', `Error checking document: ${doc.file_name}`, error, 
            { agentId, documentId: doc.id }
          );
          failedDocs.push({ doc, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      setHasTriedQuickSync(true);
      
      // If some docs are still missing, show message
      if (failedDocs.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await loadDocuments();
        
        if (successCount > 0) {
          toast.success(`✅ ${successCount} documenti già sincronizzati`);
        }
        toast.info(`${failedDocs.length} documenti richiedono re-download. Clicca "Riscarica Tutti".`, { duration: 5000 });
        return;
      }
      
      // All synced!
      await loadDocuments();
      toast.success(`✅ Tutti i ${successCount} documenti sincronizzati!`);
      if (onDocsUpdated) onDocsUpdated();
      return;
    }

    // STEP 2: Full re-download (if forced or already tried quick sync)
    const docsToRedownload = forceRedownload || hasTriedQuickSync ? missingDocs : failedDocs.map(f => f.doc);
    
    if (docsToRedownload.length > 0) {
      logger.info('document-sync', `Re-downloading ${docsToRedownload.length} documents`, undefined, { agentId });
      toast.info(`Re-download di ${docsToRedownload.length} documenti...`, { duration: 3000 });

      const remainingFailed: typeof failedDocs = [];

      for (let i = 0; i < docsToRedownload.length; i++) {
        const doc = docsToRedownload[i];
        
        try {
          // Delete existing chunks
          await supabase
            .from('agent_knowledge')
            .delete()
            .eq('agent_id', agentId)
            .eq('pool_document_id', doc.id);

          await new Promise(resolve => setTimeout(resolve, 500));

          // Sync document
          const { data, error } = await supabase.functions.invoke('sync-pool-document', {
            body: { documentId: doc.id, agentId }
          });

          if (error) {
            const errorMsg = error.message || JSON.stringify(error);
            const isFileMissing = errorMsg.includes('File not found in storage') || errorMsg.includes('not found in storage');
            
            if (isFileMissing) {
              logger.error('document-sync', `File missing in storage: ${doc.file_name}`, 
                { error: errorMsg, documentId: doc.id }, 
                { agentId, documentId: doc.id }
              );
            }
            
            throw new Error(errorMsg);
          }

          logger.success('document-sync', `Document synced successfully: ${doc.file_name}`, 
            { chunksCount: data?.chunksCount }, 
            { agentId, documentId: doc.id }
          );
          successCount++;
        } catch (error: any) {
          const errorMessage = error?.message || error?.error_description || 'Unknown error';
          logger.error('document-sync', `Failed to sync document: ${doc.file_name}`, 
            { error: errorMessage }, 
            { agentId, documentId: doc.id }
          );
          remainingFailed.push({ doc, error: errorMessage });
        }
      }

      // Mark documents with storage issues as storage_missing
      if (remainingFailed.length > 0) {
        const storageIssues = remainingFailed.filter(f => 
          f.error.includes('not found in storage') || f.error.includes('File not found')
        );
        
        if (storageIssues.length > 0) {
          setDocuments(prev => prev.map(d => {
            const hasStorageIssue = storageIssues.some(si => si.doc.id === d.id);
            return hasStorageIssue ? { ...d, syncStatus: 'storage_missing' as const } : d;
          }));
          
          toast.error(
            `${storageIssues.length} file(s) non trovati nello storage. Usa "Rimuovi Documenti Rotti" per pulire.`, 
            { duration: 8000 }
          );
        }
        
        const otherErrors = remainingFailed.filter(f => 
          !f.error.includes('not found in storage') && !f.error.includes('File not found')
        );
        
        if (otherErrors.length > 0) {
          toast.error(`Errore nella sincronizzazione di ${otherErrors.length} documento/i`);
        }
        
        console.warn('❌ Failed documents:', remainingFailed.map(f => ({
          file: f.doc.file_name,
          error: f.error
        })));
      }
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
    await loadDocuments();

    if (onDocsUpdated) {
      onDocsUpdated();
    }

    const totalMissing = missingDocs.length;
    const failedCount = totalMissing - successCount;
    
    if (failedCount === 0) {
      toast.success(`✅ Tutti i ${successCount} documenti sincronizzati!`, { duration: 5000 });
    } else {
      toast.warning(
        `Sincronizzati ${successCount}/${totalMissing} documenti. ${failedCount} file hanno problemi.`,
        { duration: 7000 }
      );
    }
  };

  const handleRemoveBrokenDocs = async () => {
    const brokenDocs = documents.filter(doc => doc.syncStatus === 'storage_missing');
    
    if (brokenDocs.length === 0) {
      toast.info('Nessun documento rotto da rimuovere');
      return;
    }

    if (!confirm(`Vuoi rimuovere ${brokenDocs.length} documento/i con file mancanti dal database?`)) {
      return;
    }

    try {
      // Remove agent_document_links for broken documents
      for (const doc of brokenDocs) {
        const { error } = await supabase
          .from('agent_document_links')
          .delete()
          .eq('id', doc.link_id);

        if (error) {
          console.error(`Error removing link for ${doc.file_name}:`, error);
          throw error;
        }
      }

      toast.success(`${brokenDocs.length} documento/i rotti rimossi con successo`);
      
      // Reset quick sync flag when removing documents
      setHasTriedQuickSync(false);
      
      await loadDocuments();
      
      if (onDocsUpdated) {
        onDocsUpdated();
      }
    } catch (error) {
      console.error('Error removing broken docs:', error);
      toast.error('Errore nella rimozione dei documenti rotti');
    }
  };

  const loadPoolDocuments = async () => {
    console.log('📚 LOAD POOL DOCUMENTS START');
    try {
      setLoadingPool(true);
      
      // Get all pool documents
      const { data: allDocs, error: docsError } = await supabase
        .from('knowledge_documents')
        .select('id, file_name, ai_summary, created_at')
        .eq('validation_status', 'validated')
        .eq('processing_status', 'ready_for_assignment')
        .order('created_at', { ascending: false });

      if (docsError) throw docsError;

      // Get already assigned documents for this agent
      const { data: assignedLinks, error: linksError } = await supabase
        .from('agent_document_links')
        .select('document_id')
        .eq('agent_id', agentId);

      if (linksError) throw linksError;

      const assignedIds = new Set(assignedLinks?.map(l => l.document_id) || []);

      const poolDocs: PoolDocument[] = (allDocs || []).map(doc => ({
        ...doc,
        isAssigned: assignedIds.has(doc.id),
      }));

      console.log('📚 LOAD POOL DOCUMENTS SUCCESS, found:', poolDocs.length);
      setPoolDocuments(poolDocs);
      setDisplayedDocuments(poolDocs);
      setSelectedDocuments(new Set());
      setSearchQuery('');
    } catch (error: any) {
      console.error('❌ Error loading pool documents:', error);
      toast.error('Errore nel caricamento dei documenti disponibili');
    } finally {
      setLoadingPool(false);
    }
  };

  const performSemanticSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setDisplayedDocuments(poolDocuments);
      return;
    }

    try {
      setSearching(true);
      console.log('🔍 Performing semantic search:', query);

      const { data, error } = await supabase.functions.invoke('search-pool-documents', {
        body: { query: query.trim(), agentId }
      });

      if (error) {
        console.error('Search error:', error);
        toast.error('Errore nella ricerca');
        return;
      }

      console.log('✅ Search results:', data.results?.length || 0);
      setDisplayedDocuments(data.results || []);
      
      if (data.results?.length === 0) {
        toast.info('Nessun documento trovato per questa ricerca');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error('Errore nella ricerca');
    } finally {
      setSearching(false);
    }
  }, [poolDocuments, agentId]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSemanticSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, performSemanticSearch]);

  const handleAssignDocuments = async () => {
    if (selectedDocuments.size === 0) {
      toast.error('Seleziona almeno un documento');
      return;
    }

    console.log('🔗 ASSIGN DOCUMENTS START');
    try {
      setAssigning(true);
      const docArray = Array.from(selectedDocuments);
      setSyncProgress({ current: 0, total: docArray.length });

      const assignments = docArray.map(docId => ({
        document_id: docId,
        agent_id: agentId,
        assignment_type: 'manual',
        confidence_score: 1.0,
      }));

      const { error } = await supabase
        .from('agent_document_links')
        .insert(assignments);

      // Handle duplicate key error - documents already assigned
      if (error && error.code !== '23505') {
        throw error;
      }
      
      // If duplicate key, log and continue with sync
      if (error && error.code === '23505') {
        console.log('⚠️ Some documents already assigned, proceeding with sync...');
      }

      // Sync each document and wait for completion
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < docArray.length; i++) {
        const docId = docArray[i];
        const docName = poolDocuments.find(d => d.id === docId)?.file_name || 'Unknown';
        
        console.log(`🔄 Syncing document ${i + 1}/${docArray.length}: ${docName}`);
        setSyncProgress({ current: i + 1, total: docArray.length });
        
        try {
          const { data, error: syncError } = await supabase.functions.invoke('sync-pool-document', {
            body: { documentId: docId, agentId }
          });

          if (syncError) throw syncError;
          
          console.log(`✅ Synced ${docName}:`, data);
          successCount++;
          setSyncStatuses(prev => new Map(prev).set(docId, 'synced'));
        } catch (syncError: any) {
          console.error(`❌ Error syncing ${docName}:`, syncError);
          errorCount++;
          setSyncStatuses(prev => new Map(prev).set(docId, 'error'));
        }
      }

      console.log(`✅ ASSIGN COMPLETE - Success: ${successCount}, Errors: ${errorCount}`);
      
      if (errorCount === 0) {
        toast.success(`${successCount} documento/i assegnato/i e sincronizzato/i con successo`);
      } else if (successCount > 0) {
        toast.warning(`${successCount} documento/i sincronizzato/i, ${errorCount} con errori`);
      } else {
        toast.error('Errore nella sincronizzazione dei documenti');
      }

      // Wait for sync to complete and reload
      await new Promise(resolve => setTimeout(resolve, 2000));
      await loadDocuments();
      
      // Notify parent to update badge
      if (onDocsUpdated) {
        onDocsUpdated();
      }

      // Close dialog after showing results
      setTimeout(() => {
        setShowAssignDialog(false);
        setSyncProgress(null);
        setSyncStatuses(new Map());
      }, 1000);
      
    } catch (error: any) {
      console.error('❌ Error assigning documents:', error);
      
      // Show specific message for duplicate key
      if (error.code === '23505') {
        toast.warning('Alcuni documenti sono già assegnati');
      } else {
        toast.error(`Errore: ${error.message}`);
      }
      
      // Close dialog immediately on error
      setShowAssignDialog(false);
      setSyncProgress(null);
      setSyncStatuses(new Map());
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassignDocument = async (linkId: string, fileName: string) => {
    console.log('🔗 UNASSIGN DOCUMENT START - Link ID:', linkId);
    setRemovingLinkId(linkId);
    
    try {
      // Delete the link from agent_document_links
      const { error } = await supabase
        .from('agent_document_links')
        .delete()
        .eq('id', linkId);

      if (error) throw error;

      console.log('✅ UNASSIGN SUCCESS - Document unassigned:', fileName);
      toast.success(`Documento "${fileName}" rimosso dalla knowledge base`);
      
      // Reset quick sync flag when unassigning documents
      setHasTriedQuickSync(false);
      
      // Reload documents but don't close the dialog
      await loadDocuments();
      
      // Notify parent to update badge
      if (onDocsUpdated) {
        onDocsUpdated();
      }
    } catch (error: any) {
      console.error('❌ Error unassigning document:', error);
      
      // Handle structured errors
      if (error.message?.includes('DOCUMENT_VALIDATION_FAILED') || error.message?.includes('validation_failed')) {
        toast.error('Documento non più valido. Rimosso dalla lista.');
        await loadDocuments();
      } else {
        toast.error('Errore nella rimozione del documento');
      }
    } finally {
      setRemovingLinkId(null);
    }
  };

  useEffect(() => {
    if (showAssignDialog) {
      loadPoolDocuments();
    }
  }, [showAssignDialog]);

  const missingCount = documents.filter(doc => doc.syncStatus === 'missing').length;
  const storageMissingCount = documents.filter(doc => doc.syncStatus === 'storage_missing').length;
  const totalIssues = missingCount + storageMissingCount;

  return (
    <Tabs defaultValue="documents" className="space-y-4">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="documents">Documenti Assegnati</TabsTrigger>
        <TabsTrigger value="alignment">Allineamento AI ✨</TabsTrigger>
      </TabsList>

      <TabsContent value="alignment">
        <KnowledgeAlignmentDashboard agentId={agentId} />
      </TabsContent>

      <TabsContent value="documents" className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold">Documenti Assegnati dal Pool</h3>
          <p className="text-sm text-muted-foreground">
            Questi documenti sono condivisi nel pool e assegnati a {agentName}
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setShowAssignDialog(true)} 
            size="sm" 
            type="button"
          >
            <Plus className="h-4 w-4 mr-2" />
            Assegna Documento
          </Button>
          
          <Button 
            onClick={async () => {
              console.log('🔄 Aggiorna Stato clicked');
              toast.info('Aggiornamento stato in corso...', { duration: 1000 });
              await loadDocuments();
            }}
            size="sm"
            variant="outline"
            type="button"
            disabled={documents.length === 0 || loading}
            title="Aggiorna lo stato di sincronizzazione dei documenti"
          >
            <RefreshCw className={loading ? "h-4 w-4 mr-2 animate-spin" : "h-4 w-4 mr-2"} />
            Aggiorna Stato
          </Button>
          
          <Button 
            onClick={() => {
              console.log('🟢 TEST BUTTON CLICKED');
              console.log('🟢 Documents:', documents.length);
              console.log('🟢 Agent ID:', agentId);
              toast.success('Test button works! Docs: ' + documents.length);
            }}
            size="sm"
            variant="secondary"
            type="button"
          >
            Test
          </Button>

          <Button 
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              
              try {
                console.log('🔵 FORCE REFRESH CLICKED - START');
                const toastId = toast.loading('Lettura database...');
                
                console.log('🔵 Agent ID:', agentId);
                console.log('🔵 Documents count:', documents.length);
                console.log('🔵 First 3 doc IDs:', documents.slice(0, 3).map(d => d.id));
                
                const docIds = documents.map(d => d.id);
                
                console.log('🔵 Querying supabase...');
                const { data, error } = await supabase
                  .from('agent_knowledge')
                  .select('pool_document_id')
                  .eq('agent_id', agentId)
                  .eq('is_active', true)
                  .in('pool_document_id', docIds);

                console.log('🔵 Query result:', { dataLength: data?.length, error });
                
                if (error) {
                  console.error('🔴 Supabase error:', error);
                  toast.error(`Errore: ${error.message}`, { id: toastId });
                  return;
                }

                const chunkCountMap = new Map<string, number>();
                data?.forEach(chunk => {
                  if (chunk.pool_document_id) {
                    const current = chunkCountMap.get(chunk.pool_document_id) || 0;
                    chunkCountMap.set(chunk.pool_document_id, current + 1);
                  }
                });

                console.log('🔵 Chunk count map:', Object.fromEntries(chunkCountMap));

                const updatedDocs = documents.map(doc => {
                  const count = chunkCountMap.get(doc.id) || 0;
                  return {
                    ...doc,
                    syncStatus: (count > 0 ? 'synced' : 'missing') as 'synced' | 'missing',
                    chunkCount: count,
                    expectedChunks: count,
                  };
                });

                console.log('🔵 Updated docs:', updatedDocs.map(d => ({ name: d.file_name, count: d.chunkCount })));
                console.log('🔵 Calling setDocuments...');
                
                setDocuments([...updatedDocs]);
                
                console.log('🔵 setDocuments called successfully');
                
                const synced = updatedDocs.filter(d => d.syncStatus === 'synced').length;
                const missing = updatedDocs.filter(d => d.syncStatus === 'missing').length;
                
                toast.success(`✅ ${synced} sincronizzati, ${missing} mancanti`, { id: toastId });
                
                if (onDocsUpdated) {
                  console.log('🔵 Calling onDocsUpdated...');
                  onDocsUpdated();
                }
                
                console.log('🔵 FORCE REFRESH CLICKED - END');
              } catch (error: any) {
                console.error('🔴 Force refresh error:', error);
                console.error('🔴 Error stack:', error?.stack);
                toast.error(`Errore: ${error?.message || 'Unknown error'}`);
              }
            }}
            size="sm"
            variant="outline"
            type="button"
            disabled={documents.length === 0}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Force Refresh {documents.length > 0 && `(${documents.length})`}
          </Button>
          
          {totalIssues > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  type="button"
                  className="gap-2"
                >
                  <Settings className="h-4 w-4" />
                  Gestione
                  <Badge variant="destructive" className="ml-1">
                    {totalIssues}
                  </Badge>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {missingCount > 0 && (
                  <DropdownMenuItem
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('🔄 Ricarica Tutti clicked');
                      toast.info('Aggiornamento stato prima della sincronizzazione...', { duration: 1500 });
                      
                      // FIRST: Refresh status from database
                      await checkSyncStatusesDirect(documents);
                      
                      // Wait a bit for state to update
                      await new Promise(resolve => setTimeout(resolve, 500));
                      
                      // THEN: Sync missing documents
                      await handleSyncAllMissing(hasTriedQuickSync);
                    }}
                  >
                    {hasTriedQuickSync ? (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Riscarica Tutti ({missingCount})
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Sincronizza Tutti ({missingCount})
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {storageMissingCount > 0 && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRemoveBrokenDocs();
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Rimuovi Documenti Rotti ({storageMissingCount})
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-4 border-2 border-dashed rounded-lg">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Nessun documento assegnato a questo agente
          </p>
        </div>
      ) : (
        <div className="w-full space-y-3">
          <ScrollArea className="h-[300px]">
            {isMobile ? (
              // Mobile: Card-based view
              <div className="space-y-3 px-1">
                {documents.map((doc) => (
                  <div key={doc.link_id} className="border rounded-lg p-3 space-y-2 bg-card">
                    {/* File name */}
                    <div className="flex items-start gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <span className="text-sm font-medium break-words flex-1" title={doc.file_name}>
                        {doc.file_name}
                      </span>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleUnassignDocument(doc.link_id, doc.file_name);
                        }}
                        disabled={removingLinkId === doc.link_id}
                        type="button"
                        title="Rimuovi assegnazione"
                        className="h-8 w-8 p-0 flex-shrink-0"
                      >
                        {removingLinkId === doc.link_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                    
                    {/* Sync status */}
                    <div className="flex items-center gap-2 text-sm">
                      {doc.syncStatus === 'checking' && (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          <span className="text-muted-foreground">Verifica...</span>
                        </>
                      )}
                      {doc.syncStatus === 'synced' && (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="text-green-600">
                            Sincronizzato
                          </span>
                        </>
                      )}
                      {doc.syncStatus === 'missing' && (
                        <>
                          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                          <span className="text-destructive">Non sincronizzato (0 chunks)</span>
                        </>
                      )}
                      {doc.syncStatus === 'storage_missing' && (
                        <>
                          <XCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                          <span className="text-red-600">File mancante</span>
                        </>
                      )}
                    </div>
                    
                    {/* Date */}
                    <div className="text-xs text-muted-foreground">
                      Assegnato {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Desktop: Table view
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[35%]">Nome Documento</TableHead>
                    <TableHead className="w-[25%]">Stato Sync</TableHead>
                    <TableHead className="w-[20%]">Assegnato</TableHead>
                    <TableHead className="w-[20%] text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow key={doc.link_id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 min-w-0 max-w-full">
                          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate" title={doc.file_name}>
                            {doc.file_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {doc.syncStatus === 'checking' && (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">Verifica...</span>
                            </>
                          )}
                          {doc.syncStatus === 'synced' && (
                            <>
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              <span className="text-sm text-green-600">
                                Sincronizzato
                              </span>
                            </>
                          )}
                          {doc.syncStatus === 'missing' && (
                            <>
                              <AlertCircle className="h-4 w-4 text-destructive" />
                              <span className="text-sm text-destructive">Non sincronizzato (0 chunks)</span>
                            </>
                          )}
                          {doc.syncStatus === 'storage_missing' && (
                            <>
                              <XCircle className="h-4 w-4 text-red-600" />
                              <span className="text-sm text-red-600">File mancante</span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true, locale: undefined })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleUnassignDocument(doc.link_id, doc.file_name);
                          }}
                          disabled={removingLinkId === doc.link_id}
                          type="button"
                          title="Rimuovi assegnazione"
                        >
                          {removingLinkId === doc.link_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </div>
      )}

      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Assegna Documenti dal Pool</DialogTitle>
            <DialogDescription>
              Seleziona i documenti dal pool condiviso da assegnare a {agentName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pb-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca documenti (es: team building, leadership)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Results count */}
            {searchQuery && (
              <div className="flex items-center justify-between text-sm">
                <Badge variant="outline">
                  {displayedDocuments.length} risultat{displayedDocuments.length === 1 ? 'o' : 'i'} per "{searchQuery}"
                </Badge>
                {displayedDocuments.length > 0 && displayedDocuments.some(d => d.similarity) && (
                  <span className="text-xs text-muted-foreground">
                    Ordinati per rilevanza
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {loadingPool ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : displayedDocuments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? 'Nessun documento trovato per questa ricerca' : 'Nessun documento disponibile nel pool'}
              </div>
            ) : (
              <div className="space-y-2">
                {displayedDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className={`flex items-start gap-3 p-3 border rounded-lg ${
                      doc.isAssigned ? 'bg-muted opacity-60' : 'hover:bg-accent'
                    }`}
                  >
                    <Checkbox
                      checked={selectedDocuments.has(doc.id)}
                      disabled={doc.isAssigned}
                      onCheckedChange={(checked) => {
                        const newSelected = new Set(selectedDocuments);
                        if (checked) {
                          newSelected.add(doc.id);
                        } else {
                          newSelected.delete(doc.id);
                        }
                        setSelectedDocuments(newSelected);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <p className="font-medium truncate">{doc.file_name}</p>
                        {doc.isAssigned && (
                          <Badge variant="secondary" className="text-xs">già assegnato</Badge>
                        )}
                        {doc.similarity !== undefined && doc.similarity > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {Math.round(doc.similarity * 100)}% rilevanza
                          </Badge>
                        )}
                      </div>
                      {doc.ai_summary && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {doc.ai_summary}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Caricato {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <div className="text-sm">
              {syncProgress ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Sincronizzazione {syncProgress.current}/{syncProgress.total}...</span>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  {selectedDocuments.size} documento/i selezionato/i
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAssignDialog(false)}
                disabled={assigning}
                type="button"
              >
                Annulla
              </Button>
              <Button
                onClick={handleAssignDocuments}
                disabled={selectedDocuments.size === 0 || assigning}
                type="button"
              >
                {assigning && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Assegna e Sincronizza
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </TabsContent>
    </Tabs>
  );
};
