import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Trash2, CheckCircle, XCircle, Clock, AlertCircle, FileText, FolderOpen, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDistanceToNow } from "date-fns";
import { DocumentDetailsDialog } from "./DocumentDetailsDialog";
import { AssignDocumentDialog } from "./AssignDocumentDialog";
import { BulkAssignDocumentDialog } from "./BulkAssignDocumentDialog";

interface Document {
  id: string;
  file_name: string;
  created_at: string;
  status: string;
  processing_status?: string;
  validation_status?: string;
  error_message?: string | null;
  page_count?: number | null;
  text_length?: number | null;
  ai_summary?: string | null;
  pipeline: 'a' | 'b' | 'c';
  isAssignable: boolean;
}

export const DocumentPoolTable = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningDoc, setAssigningDoc] = useState<Document | null>(null);
  const [bulkAssignDialogOpen, setBulkAssignDialogOpen] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [bulkAssignFolderName, setBulkAssignFolderName] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    loadDocuments(controller.signal);

    return () => {
      controller.abort();
    };
  }, []);

  const loadDocuments = async (signal?: AbortSignal) => {
    console.log('[DocumentPoolTable] Loading documents from ALL pipelines');
    
    try {
      setLoading(true);
      setError(null);
      
      const [pipelineAData, pipelineBData, pipelineCData] = await Promise.all([
        supabase
          .from("pipeline_a_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .abortSignal(signal),
        supabase
          .from("pipeline_b_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .abortSignal(signal),
        supabase
          .from("pipeline_c_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .abortSignal(signal)
      ]);

      if (pipelineAData.error) throw pipelineAData.error;
      if (pipelineBData.error) throw pipelineBData.error;
      if (pipelineCData.error) throw pipelineCData.error;

      const transformedA: Document[] = (pipelineAData.data || []).map(doc => ({
        id: doc.id,
        file_name: doc.file_name,
        created_at: doc.created_at,
        status: doc.status,
        error_message: doc.error_message,
        page_count: doc.page_count,
        pipeline: 'a' as const,
        isAssignable: doc.status === 'ready'
      }));

      const transformedB: Document[] = (pipelineBData.data || []).map(doc => ({
        id: doc.id,
        file_name: doc.file_name,
        created_at: doc.created_at,
        status: doc.status,
        error_message: doc.error_message,
        page_count: doc.page_count,
        pipeline: 'b' as const,
        isAssignable: doc.status === 'ready'
      }));

      const transformedC: Document[] = (pipelineCData.data || []).map(doc => ({
        id: doc.id,
        file_name: doc.file_name,
        created_at: doc.created_at,
        status: doc.status,
        error_message: doc.error_message,
        page_count: doc.page_count,
        pipeline: 'c' as const,
        isAssignable: doc.status === 'ready'
      }));

      const allDocs = [...transformedA, ...transformedB, ...transformedC]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      console.log('[DocumentPoolTable] Total documents:', allDocs.length, 
        '(Pipeline A:', transformedA.length, 'Pipeline B:', transformedB.length, 'Pipeline C:', transformedC.length, ')');
      
      setDocuments(allDocs);
    } catch (error: any) {
      const isAbortError = error.name === 'AbortError' || error.message?.includes('aborted');
      
      if (isAbortError) {
        console.log('[DocumentPoolTable] Load aborted (component unmounted or cleanup)');
        return;
      }
      
      console.error('[DocumentPoolTable] Load error:', error);
      setError('Errore nel caricamento dei documenti');
      toast.error('Errore nel caricamento dei documenti');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Eliminare definitivamente il documento "${doc.file_name}"?`)) {
      return;
    }

    try {
      console.log(`[DELETE] Starting deletion for ${doc.pipeline.toUpperCase()} document:`, doc.id);

      if (doc.pipeline === 'a') {
        // Pipeline A deletion
        const { data: chunks } = await supabase
          .from("pipeline_a_chunks_raw")
          .select("id")
          .eq("document_id", doc.id);

        const chunkIds = chunks?.map(c => c.id) || [];

        if (chunkIds.length > 0) {
          await supabase
            .from("pipeline_a_agent_knowledge")
            .delete()
            .in("chunk_id", chunkIds);
        }

        await supabase
          .from("pipeline_a_chunks_raw")
          .delete()
          .eq("document_id", doc.id);

        const { data: docData } = await supabase
          .from("pipeline_a_documents")
          .select("storage_bucket, file_path")
          .eq("id", doc.id)
          .single();

        if (docData?.storage_bucket && docData?.file_path) {
          await supabase.storage
            .from(docData.storage_bucket)
            .remove([docData.file_path]);
        }

        await supabase
          .from("pipeline_a_documents")
          .delete()
          .eq("id", doc.id);

        toast.success("Documento Pipeline A eliminato");
      } else if (doc.pipeline === 'b') {
        // Pipeline B deletion
        const { data: chunks } = await supabase
          .from("pipeline_b_chunks_raw")
          .select("id")
          .eq("document_id", doc.id);

        const chunkIds = chunks?.map(c => c.id) || [];

        if (chunkIds.length > 0) {
          await supabase
            .from("pipeline_b_agent_knowledge")
            .delete()
            .in("chunk_id", chunkIds);
        }

        await supabase
          .from("pipeline_b_chunks_raw")
          .delete()
          .eq("document_id", doc.id);

        const { data: docData } = await supabase
          .from("pipeline_b_documents")
          .select("storage_bucket, file_path")
          .eq("id", doc.id)
          .single();

        if (docData?.storage_bucket && docData?.file_path) {
          await supabase.storage
            .from(docData.storage_bucket)
            .remove([docData.file_path]);
        }

        await supabase
          .from("pipeline_b_documents")
          .delete()
          .eq("id", doc.id);

        toast.success("Documento Pipeline B eliminato");
      } else if (doc.pipeline === 'c') {
        // Pipeline C deletion
        const { data: chunks } = await supabase
          .from("pipeline_c_chunks_raw")
          .select("id")
          .eq("document_id", doc.id);

        const chunkIds = chunks?.map(c => c.id) || [];

        if (chunkIds.length > 0) {
          await supabase
            .from("pipeline_c_agent_knowledge")
            .delete()
            .in("chunk_id", chunkIds);
        }

        await supabase
          .from("pipeline_c_chunks_raw")
          .delete()
          .eq("document_id", doc.id);

        const { data: docData } = await supabase
          .from("pipeline_c_documents")
          .select("storage_bucket, file_path")
          .eq("id", doc.id)
          .single();

        if (docData?.storage_bucket && docData?.file_path) {
          await supabase.storage
            .from(docData.storage_bucket)
            .remove([docData.file_path]);
        }

        await supabase
          .from("pipeline_c_documents")
          .delete()
          .eq("id", doc.id);

        toast.success("Documento Pipeline C eliminato");
      }

      loadDocuments();
    } catch (error: any) {
      console.error('[DELETE] Error:', error);
      toast.error("Errore durante l'eliminazione");
    }
  };

  const getStatusBadge = (doc: Document) => {
    switch (doc.status) {
      case 'ready':
        return <Badge variant="default" className="gap-1"><CheckCircle className="w-3 h-3" />Pronto</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Fallito</Badge>;
      case 'ingested':
      case 'processing':
      case 'chunked':
        return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />In elaborazione</Badge>;
      default:
        return <Badge variant="outline">{doc.status}</Badge>;
    }
  };

  const getPipelineBadge = (pipeline: 'a' | 'b' | 'c') => {
    const labels = { a: 'Pipeline A', b: 'Pipeline B', c: 'Pipeline C' };
    const colors = { a: 'bg-purple-100 text-purple-800', b: 'bg-blue-100 text-blue-800', c: 'bg-green-100 text-green-800' };
    return <Badge className={colors[pipeline]}>{labels[pipeline]}</Badge>;
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const assignableIds = documents.filter(d => d.isAssignable).map(d => d.id);
      setSelectedDocIds(new Set(assignableIds));
    } else {
      setSelectedDocIds(new Set());
    }
  };

  const handleSelectDoc = (docId: string, checked: boolean) => {
    setSelectedDocIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(docId);
      } else {
        newSet.delete(docId);
      }
      return newSet;
    });
  };

  const handleBulkAssign = () => {
    if (selectedDocIds.size === 0) {
      toast.error("Seleziona almeno un documento");
      return;
    }
    setBulkAssignFolderName(null);
    setBulkAssignDialogOpen(true);
  };

  const assignableCount = documents.filter(d => d.isAssignable).length;
  const allAssignableSelected = assignableCount > 0 && selectedDocIds.size === assignableCount;

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Documenti nel Pool</h2>
          <Badge variant="secondary">{documents.length} totali</Badge>
          <Badge variant="default">{assignableCount} assegnabili</Badge>
        </div>
        <div className="flex gap-2">
          {selectedDocIds.size > 0 && (
            <Button onClick={handleBulkAssign} size="sm">
              Assegna {selectedDocIds.size} selezionati
            </Button>
          )}
          <Button onClick={() => loadDocuments()} variant="outline" size="sm" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ricarica"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Nessun documento nel pool</p>
        </div>
      ) : (
        <ScrollArea className="h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={allAssignableSelected}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Nome File</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Pagine</TableHead>
                <TableHead>Creato</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id} className={!doc.isAssignable ? 'opacity-50' : ''}>
                  <TableCell>
                    <Checkbox
                      checked={selectedDocIds.has(doc.id)}
                      onCheckedChange={(checked) => handleSelectDoc(doc.id, !!checked)}
                      disabled={!doc.isAssignable}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {doc.file_name}
                    </div>
                  </TableCell>
                  <TableCell>{getPipelineBadge(doc.pipeline)}</TableCell>
                  <TableCell>{getStatusBadge(doc)}</TableCell>
                  <TableCell>{doc.page_count || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAssigningDoc(doc);
                          setAssignDialogOpen(true);
                        }}
                        disabled={!doc.isAssignable}
                      >
                        Assegna
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(doc)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}

      {assigningDoc && (
        <AssignDocumentDialog
          document={assigningDoc}
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          onAssigned={() => {
            setAssignDialogOpen(false);
            setAssigningDoc(null);
            loadDocuments();
          }}
        />
      )}

      <BulkAssignDocumentDialog
        documentIds={Array.from(selectedDocIds)}
        folderName={bulkAssignFolderName}
        open={bulkAssignDialogOpen}
        onOpenChange={setBulkAssignDialogOpen}
        onAssigned={() => {
          setSelectedDocIds(new Set());
          setBulkAssignFolderName(null);
          loadDocuments();
        }}
      />
    </div>
  );
};
