import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, FileText, Plus, RefreshCw, CheckCircle2, AlertCircle, Download } from "lucide-react";
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
  syncStatus?: 'synced' | 'missing' | 'checking';
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
  const isMobile = useIsMobile();

  useEffect(() => {
    loadDocuments();
  }, [agentId]);

  const loadDocuments = async () => {
    console.log('📄 LOAD ASSIGNED DOCUMENTS START - Agent:', agentId);
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

      if (error) throw error;

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

      console.log('📄 LOAD ASSIGNED DOCUMENTS SUCCESS, found:', transformedData.length, 'documents');
      setDocuments(transformedData);

      // Check sync status for each document
      if (transformedData.length > 0) {
        checkSyncStatuses(transformedData);
      }
    } catch (error: any) {
      console.error('❌ Error loading assigned documents:', error);
    } finally {
      setLoading(false);
      console.log('📄 LOAD ASSIGNED DOCUMENTS END');
    }
  };

  const checkSyncStatuses = async (docs: KnowledgeDocument[]) => {
    try {
      console.log('🔍 Checking sync status for', docs.length, 'documents...');
      
      const { data, error } = await supabase.functions.invoke('check-and-sync-all', {
        body: { agentId, autoFix: false }
      });

      if (error) throw error;

      console.log('📊 Sync check response:', {
        totalAssigned: data?.totalAssigned,
        totalSynced: data?.totalSynced,
        missingCount: data?.missingCount,
        statuses: data?.statuses?.map((s: any) => ({
          fileName: s.fileName,
          status: s.status,
          chunkCount: s.chunkCount
        }))
      });

      if (data?.statuses) {
        const updatedDocs = docs.map(doc => {
          const status = data.statuses.find((s: any) => s.documentId === doc.id);
          if (status) {
            console.log(`  ${status.fileName}: ${status.status} (${status.chunkCount} chunks)`);
            return {
              ...doc,
              syncStatus: (status.status === 'synced' ? 'synced' : 'missing') as 'synced' | 'missing',
              chunkCount: status.chunkCount || 0,
            };
          }
          return doc;
        });
        setDocuments(updatedDocs);
        
        // Notify parent component about doc updates
        if (onDocsUpdated) {
          onDocsUpdated();
        }
      }
    } catch (error) {
      console.error('❌ Error checking sync statuses:', error);
    }
  };

  const handleFullRedownload = async (docId: string, fileName: string) => {
    console.log('🔄 FULL RE-DOWNLOAD for document:', fileName, 'ID:', docId);
    try {
      toast.info(`Rimozione chunks esistenti per ${fileName}...`);
      
      // Step 1: Delete ALL existing chunks for this document+agent
      console.log('🗑️ Deleting all existing chunks...');
      const { error: deleteError } = await supabase
        .from('agent_knowledge')
        .delete()
        .eq('agent_id', agentId)
        .eq('pool_document_id', docId);
      
      if (deleteError) {
        console.error('❌ Delete error:', deleteError);
        throw deleteError;
      }
      
      console.log('✅ All chunks deleted successfully');
      toast.info(`Re-sincronizzazione completa di ${fileName}...`);
      
      // Step 2: Wait a bit for database commit
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Step 3: Perform fresh sync
      console.log('🔄 Starting fresh sync...');
      const { data, error } = await supabase.functions.invoke('sync-pool-document', {
        body: { documentId: docId, agentId }
      });

      if (error) throw error;
      
      console.log('✅ Fresh sync response:', data);
      toast.success(`${fileName} ri-sincronizzato con successo (${data?.chunksCount || 0} chunks)`);
      
      // Step 4: Wait for final database commit (increased to 5s for large documents)
      console.log('⏳ Waiting for final database commit...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Step 5: Reload documents to reflect new state
      console.log('🔄 Reloading documents...');
      await loadDocuments();
      
      // Notify parent to update badge
      if (onDocsUpdated) {
        onDocsUpdated();
      }
    } catch (error: any) {
      console.error('❌ Full re-download error:', error);
      toast.error(`Errore re-download ${fileName}: ${error.message}`);
    }
  };

  const handleResync = async (docId: string, fileName: string) => {
    console.log('🔄 Quick re-sync check for document:', fileName, 'ID:', docId);
    try {
      toast.info(`Verifica sincronizzazione di ${fileName}...`);
      
      // Check if chunks already exist
      console.log('🔍 Checking if chunks exist for document...');
      const { data: existingChunks, error: checkError } = await supabase
        .from('agent_knowledge')
        .select('id, source_type')
        .eq('agent_id', agentId)
        .eq('pool_document_id', docId);
      
      if (checkError) throw checkError;
      
      console.log('📊 Existing chunks found:', {
        fileName,
        chunkCount: existingChunks?.length || 0,
        sourceTypes: existingChunks?.map(c => c.source_type)
      });
      
      if (existingChunks && existingChunks.length > 0) {
        // Document is already synced! Just update UI
        console.log('✅ Document already has', existingChunks.length, 'chunks - updating UI');
        toast.success(`${fileName} già sincronizzato (${existingChunks.length} chunks trovati)`);
        
        // Update the document status in state immediately
        setDocuments(prev => prev.map(doc => 
          doc.id === docId 
            ? { ...doc, syncStatus: 'synced' as const, chunkCount: existingChunks.length }
            : doc
        ));
        
        // Notify parent to update badge
        if (onDocsUpdated) {
          onDocsUpdated();
        }
        return;
      }
      
      // No chunks found - suggest full re-download instead
      console.log('⚠️ No chunks found - suggesting full re-download');
      toast.error(`${fileName} non ha chunks. Usa "Re-download" per risolvere.`);
    } catch (error: any) {
      console.error('❌ Sync check error:', error);
      toast.error(`Errore verifica ${fileName}: ${error.message}`);
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Documenti Assegnati dal Pool</h3>
          <p className="text-sm text-muted-foreground">
            Questi documenti sono condivisi nel pool e assegnati a {agentName}
          </p>
        </div>
        <Button onClick={() => setShowAssignDialog(true)} size="sm" type="button">
          <Plus className="h-4 w-4 mr-2" />
          Assegna Documento
        </Button>
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
                    </div>

                    {/* Action buttons for missing sync */}
                    {doc.syncStatus === 'missing' && (
                      <div className="flex flex-col gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResync(doc.id, doc.file_name)}
                          className="w-full justify-start"
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Verifica sincronizzazione
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleFullRedownload(doc.id, doc.file_name)}
                          className="w-full justify-start"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Re-download completo
                        </Button>
                      </div>
                    )}
                    
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
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-destructive" />
                              <div className="flex gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleResync(doc.id, doc.file_name)}
                                  className="h-7 px-2 text-xs"
                                >
                                  <RefreshCw className="h-3 w-3 mr-1" />
                                  Verifica
                                </Button>
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleFullRedownload(doc.id, doc.file_name)}
                                  className="h-7 px-2 text-xs"
                                >
                                  <Download className="h-3 w-3 mr-1" />
                                  Re-download
                                </Button>
                              </div>
                            </div>
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
