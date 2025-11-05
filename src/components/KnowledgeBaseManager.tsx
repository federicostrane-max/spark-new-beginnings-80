import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, FileText, Plus, RefreshCw, CheckCircle2, AlertCircle, Download, XCircle } from "lucide-react";
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

interface KnowledgeDocument {
  id: string;
  file_name: string;
  ai_summary: string | null;
  created_at: string;
  assignment_type: string;
  link_id: string;
  syncStatus?: 'synced' | 'missing' | 'checking' | 'storage_missing';
  chunkCount?: number;
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
  const isMobile = useIsMobile();

  useEffect(() => {
    loadDocuments();
  }, [agentId]);

  const loadDocuments = async () => {
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

      // Check sync status for each document
      if (transformedData.length > 0) {
        checkSyncStatuses(transformedData);
      }
    } catch (error: any) {
      logger.error('knowledge-base', 'Error loading assigned documents', error, { agentId });
    } finally {
      setLoading(false);
    }
  };

  const checkSyncStatuses = async (docs: KnowledgeDocument[]) => {
    try {
      logger.info('document-sync', `Checking sync status for ${docs.length} documents`, undefined, { agentId });
      
      const { data, error } = await supabase.functions.invoke('check-and-sync-all', {
        body: { agentId, autoFix: false }
      });

      if (error) {
        logger.error('document-sync', 'Failed to check sync statuses', error, { agentId });
        throw error;
      }

      if (data?.statuses) {
        const updatedDocs = docs.map(doc => {
          const status = data.statuses.find((s: any) => s.documentId === doc.id);
          if (status) {
            if (status.status !== 'synced') {
              logger.warning('document-sync', `Document not synced: ${status.fileName}`, 
                { status: status.status, chunkCount: status.chunkCount }, 
                { agentId, documentId: doc.id }
              );
            }
            return {
              ...doc,
              syncStatus: (status.status === 'synced' ? 'synced' : 'missing') as 'synced' | 'missing',
              chunkCount: status.chunkCount || 0,
            };
          }
          return doc;
        });
        setDocuments(updatedDocs);
        
        const missingCount = updatedDocs.filter(d => d.syncStatus === 'missing').length;
        if (missingCount > 0) {
          logger.warning('document-sync', `${missingCount} documents not synced`, 
            { total: docs.length, missing: missingCount }, 
            { agentId }
          );
        } else {
          logger.success('document-sync', 'All documents synced successfully', undefined, { agentId });
        }
        
        // Reset quick sync flag only if all documents are synced
        const allSynced = updatedDocs.every(doc => doc.syncStatus === 'synced');
        if (allSynced) {
          setHasTriedQuickSync(false);
        }
        
        // Notify parent component about doc updates
        if (onDocsUpdated) {
          onDocsUpdated();
        }
      }
    } catch (error) {
      logger.error('document-sync', 'Error checking sync statuses', error, { agentId });
    }
  };


  const handleSyncAllMissing = async (forceRedownload = false) => {
    const missingDocs = documents.filter(doc => doc.syncStatus === 'missing');
    
    if (missingDocs.length === 0) {
      toast.info('Nessun documento da sincronizzare');
      return;
    }

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
            throw new Error(error.message || 'Sync failed');
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
      setSelectedDocuments(new Set());
    } catch (error: any) {
      console.error('❌ Error loading pool documents:', error);
      toast.error('Errore nel caricamento dei documenti disponibili');
    } finally {
      setLoadingPool(false);
    }
  };

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

      if (error) throw error;

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

      // Don't close the dialog automatically - let user verify sync status
      setSyncProgress(null);
      loadDocuments();
      
      // Notify parent to update badge
      if (onDocsUpdated) {
        onDocsUpdated();
      }
    } catch (error: any) {
      console.error('❌ Error assigning documents:', error);
      toast.error('Errore nell\'assegnazione dei documenti');
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassignDocument = async (linkId: string, fileName: string) => {
    console.log('🔗 UNASSIGN DOCUMENT START - Link ID:', linkId);
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
      loadDocuments();
      
      // Notify parent to update badge
      if (onDocsUpdated) {
        onDocsUpdated();
      }
    } catch (error: any) {
      console.error('❌ Error unassigning document:', error);
      toast.error('Errore nella rimozione del documento');
    }
  };

  useEffect(() => {
    if (showAssignDialog) {
      loadPoolDocuments();
    }
  }, [showAssignDialog]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold">Documenti Assegnati dal Pool</h3>
          <p className="text-sm text-muted-foreground">
            Questi documenti sono condivisi nel pool e assegnati a {agentName}
          </p>
        </div>
        <div className="flex gap-2">
          {documents.some(doc => doc.syncStatus === 'missing') && (
            <Button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSyncAllMissing(hasTriedQuickSync);
              }} 
              size="sm" 
              type="button"
              variant="default"
            >
              {hasTriedQuickSync ? (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Riscarica Tutti
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sincronizza Tutti
                </>
              )}
            </Button>
          )}
          {documents.some(doc => doc.syncStatus === 'storage_missing') && (
            <Button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleRemoveBrokenDocs();
              }} 
              size="sm" 
              type="button"
              variant="destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Rimuovi Documenti Rotti
            </Button>
          )}
          <Button onClick={() => setShowAssignDialog(true)} size="sm" type="button">
            <Plus className="h-4 w-4 mr-2" />
            Assegna Documento
          </Button>
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
                        type="button"
                        title="Rimuovi assegnazione"
                        className="h-8 w-8 p-0 flex-shrink-0"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
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
                            Sincronizzato ({doc.chunkCount} chunks)
                          </span>
                        </>
                      )}
                      {doc.syncStatus === 'missing' && (
                        <>
                          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                          <span className="text-destructive">Non sincronizzato</span>
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
                                Sincronizzato ({doc.chunkCount} chunks)
                              </span>
                            </>
                          )}
                          {doc.syncStatus === 'missing' && (
                            <>
                              <AlertCircle className="h-4 w-4 text-destructive" />
                              <span className="text-sm text-destructive">Non sincronizzato</span>
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
                          type="button"
                          title="Rimuovi assegnazione"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
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

          <div className="flex-1 overflow-auto">
            {loadingPool ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : poolDocuments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nessun documento disponibile nel pool
              </div>
            ) : (
              <div className="space-y-2">
                {poolDocuments.map((doc) => (
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
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <p className="font-medium truncate">{doc.file_name}</p>
                        {doc.isAssigned && (
                          <span className="text-xs text-muted-foreground">(già assegnato)</span>
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
    </div>
  );
};
