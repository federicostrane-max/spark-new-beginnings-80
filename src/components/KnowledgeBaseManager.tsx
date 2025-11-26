import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, FileText, Plus, RefreshCw, CheckCircle2, AlertCircle, Download, Search } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KnowledgeAlignmentDashboard } from "./KnowledgeAlignmentDashboard";
import { useDocumentSync } from "@/hooks/useDocumentSync";
import { useDocumentAssignment } from "@/hooks/useDocumentAssignment";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PoolDocument {
  id: string;
  file_name: string;
  ai_summary: string | null;
  created_at: string;
  isAssigned: boolean;
}

interface KnowledgeBaseManagerProps {
  agentId: string;
  agentName: string;
  onDocsUpdated?: () => void;
}

export const KnowledgeBaseManager = ({ agentId, agentName, onDocsUpdated }: KnowledgeBaseManagerProps) => {
  const { 
    documents, 
    isLoading: loading, 
    loadDocuments,
  } = useDocumentSync(agentId);
  
  const { assignDocument, unassignDocument, reprocessDocument, isAssigning } = useDocumentAssignment();
  
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [poolDocuments, setPoolDocuments] = useState<PoolDocument[]>([]);
  const [loadingPool, setLoadingPool] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [removingLinkId, setRemovingLinkId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  // Carica documenti all'avvio
  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Notifica il parent quando i documenti cambiano
  useEffect(() => {
    if (onDocsUpdated && documents.length > 0) {
      onDocsUpdated();
    }
  }, [documents, onDocsUpdated]);

  const loadPoolDocuments = useCallback(async () => {
    setLoadingPool(true);
    try {
      // Load documents from all pipelines
      const [aData, bData, cData] = await Promise.all([
        supabase.from('pipeline_a_documents').select('id, file_name, created_at, status').eq('status', 'ready').order('created_at', { ascending: false }).limit(50),
        supabase.from('pipeline_b_documents').select('id, file_name, created_at, status').eq('status', 'ready').order('created_at', { ascending: false }).limit(50),
        supabase.from('pipeline_c_documents').select('id, file_name, created_at, status').eq('status', 'ready').order('created_at', { ascending: false }).limit(50)
      ]);

      const assignedIds = new Set(documents.map(d => d.id));
      
      const allDocs = [
        ...(aData.data || []).map(doc => ({ ...doc, ai_summary: null })),
        ...(bData.data || []).map(doc => ({ ...doc, ai_summary: null })),
        ...(cData.data || []).map(doc => ({ ...doc, ai_summary: null }))
      ];

      const poolDocs: PoolDocument[] = allDocs.map(doc => ({
        id: doc.id,
        file_name: doc.file_name,
        ai_summary: doc.ai_summary,
        created_at: doc.created_at,
        isAssigned: assignedIds.has(doc.id),
      }));

      setPoolDocuments(poolDocs);
    } catch (error) {
      console.error('Error loading pool documents:', error);
      toast.error('Errore nel caricamento del pool');
    } finally {
      setLoadingPool(false);
    }
  }, [documents]);

  const performSemanticSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      await loadPoolDocuments();
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('search-pool-documents', {
        body: { searchQuery: query, limit: 50 },
      });

      if (error) throw error;

      const assignedIds = new Set(documents.map(d => d.id));
      const searchResults: PoolDocument[] = (data?.results || []).map((doc: any) => ({
        id: doc.id,
        file_name: doc.file_name,
        ai_summary: doc.ai_summary,
        created_at: doc.created_at,
        isAssigned: assignedIds.has(doc.id),
      }));

      setPoolDocuments(searchResults);
    } catch (error) {
      console.error('Error searching documents:', error);
      toast.error('Errore nella ricerca');
    } finally {
      setSearching(false);
    }
  }, [documents, loadPoolDocuments]);

  const handleOpenAssignDialog = () => {
    setShowAssignDialog(true);
    loadPoolDocuments();
  };

  const handleAssignDocuments = async () => {
    if (selectedDocuments.size === 0) {
      toast.error('Seleziona almeno un documento');
      return;
    }

    try {
      const documentIds = Array.from(selectedDocuments);
      let successCount = 0;
      
      // Assign documents one by one using the new function
      for (const docId of documentIds) {
        const success = await assignDocument(agentId, docId);
        if (success) successCount++;
      }
      
      if (successCount > 0) {
        toast.success(`${successCount} documenti assegnati con successo`);
      }
      
      // Reload documents
      await loadDocuments();
      
      // Close dialog and reset selection
      setShowAssignDialog(false);
      setSelectedDocuments(new Set());
    } catch (error) {
      console.error('Error assigning documents:', error);
      toast.error('Errore nell\'assegnazione');
    }
  };

  const handleUnassignDocument = async (documentId: string) => {
    setRemovingLinkId(documentId);
    try {
      const success = await unassignDocument(agentId, documentId);
      if (success) {
        await loadDocuments();
      }
    } catch (error) {
      console.error('Error removing document:', error);
    } finally {
      setRemovingLinkId(null);
    }
  };

  // Sync function removed - synchronization handled by background cron job

  const getSyncStatusBadge = (doc: typeof documents[0]) => {
    switch (doc.syncStatus) {
      case 'synced':
        return (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Sincronizzato ({doc.chunkCount})
          </Badge>
        );
      case 'missing':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="w-3 h-3" />
            Non sincronizzato (0 chunks)
          </Badge>
        );
      case 'checking':
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Verifica...
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            Sconosciuto
          </Badge>
        );
    }
  };

  const missingCount = documents.filter(d => d.syncStatus === 'missing').length;
  const syncedCount = documents.filter(d => d.syncStatus === 'synced').length;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="documents" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="documents">Documenti Assegnati</TabsTrigger>
          <TabsTrigger value="alignment">Allineamento AI</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="space-y-4">
          {/* Header Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Totale Documenti</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{documents.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Sincronizzati</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{syncedCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Non Sincronizzati</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{missingCount}</div>
              </CardContent>
            </Card>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleOpenAssignDialog} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Assegna Documento
            </Button>
            <Button onClick={loadDocuments} variant="outline" size="sm" disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Ricarica
            </Button>
          </div>

          {/* Documents Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Nessun documento assegnato</p>
                <Button onClick={handleOpenAssignDialog} className="mt-4" size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Assegna il primo documento
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ScrollArea className="h-[calc(100vh-280px)] min-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow className="h-10">
                      <TableHead className="py-2">Nome File</TableHead>
                      <TableHead className="py-2">Riepilogo</TableHead>
                      <TableHead className="py-2">Stato</TableHead>
                      <TableHead className="py-2">Assegnato</TableHead>
                      <TableHead className="py-2 text-right">Azioni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id} className="h-12">
                        <TableCell className="py-2 font-medium">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{doc.file_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[300px] py-2">
                          <p className="text-xs text-muted-foreground truncate">
                            {doc.ai_summary || 'Nessun riepilogo disponibile'}
                          </p>
                        </TableCell>
                        <TableCell className="py-2">
                          {getSyncStatusBadge(doc)}
                        </TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleUnassignDocument(doc.id)}
                            disabled={removingLinkId === doc.id}
                          >
                            {removingLinkId === doc.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="alignment">
          <KnowledgeAlignmentDashboard agentId={agentId} />
        </TabsContent>
      </Tabs>

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Assegna Documenti dal Pool</DialogTitle>
            <DialogDescription>
              Seleziona i documenti da assegnare a {agentName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Cerca documenti..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    performSemanticSearch(searchQuery);
                  }
                }}
              />
              <Button
                onClick={() => performSemanticSearch(searchQuery)}
                disabled={searching}
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>

            <ScrollArea className="h-[400px]">
              {loadingPool ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : poolDocuments.length === 0 ? (
                <p className="text-center text-muted-foreground py-12">
                  Nessun documento disponibile
                </p>
              ) : (
                <div className="space-y-2">
                  {poolDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent cursor-pointer"
                      onClick={() => {
                        if (!doc.isAssigned) {
                          const newSelection = new Set(selectedDocuments);
                          if (newSelection.has(doc.id)) {
                            newSelection.delete(doc.id);
                          } else {
                            newSelection.add(doc.id);
                          }
                          setSelectedDocuments(newSelection);
                        }
                      }}
                    >
                      <Checkbox
                        checked={selectedDocuments.has(doc.id) || doc.isAssigned}
                        disabled={doc.isAssigned}
                      />
                      <div className="flex-1 space-y-1">
                        <p className="font-medium text-sm">{doc.file_name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {doc.ai_summary || 'Nessun riepilogo'}
                        </p>
                        {doc.isAssigned && (
                          <Badge variant="secondary" className="text-xs">
                            Già assegnato
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="flex justify-between items-center pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                {selectedDocuments.size} documenti selezionati
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowAssignDialog(false)}
                >
                  Annulla
                </Button>
                <Button
                  onClick={handleAssignDocuments}
                  disabled={selectedDocuments.size === 0 || isAssigning}
                >
                  {isAssigning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Assegnazione...
                    </>
                  ) : (
                    'Assegna'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
