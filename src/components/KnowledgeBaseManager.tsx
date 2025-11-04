import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, FileText, Plus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
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
}

interface KnowledgeBaseManagerProps {
  agentId: string;
  agentName: string;
}

interface PoolDocument {
  id: string;
  file_name: string;
  ai_summary: string | null;
  created_at: string;
  isAssigned: boolean;
}

export const KnowledgeBaseManager = ({ agentId, agentName }: KnowledgeBaseManagerProps) => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [poolDocuments, setPoolDocuments] = useState<PoolDocument[]>([]);
  const [loadingPool, setLoadingPool] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

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
        }));

      console.log('📄 LOAD ASSIGNED DOCUMENTS SUCCESS, found:', transformedData.length, 'documents');
      setDocuments(transformedData);
    } catch (error: any) {
      console.error('❌ Error loading assigned documents:', error);
    } finally {
      setLoading(false);
      console.log('📄 LOAD ASSIGNED DOCUMENTS END');
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

      const assignments = Array.from(selectedDocuments).map(docId => ({
        document_id: docId,
        agent_id: agentId,
        assignment_type: 'manual',
        confidence_score: 1.0,
      }));

      const { error } = await supabase
        .from('agent_document_links')
        .insert(assignments);

      if (error) throw error;

      console.log('✅ ASSIGN SUCCESS - Assigned', selectedDocuments.size, 'documents');
      toast.success(`${selectedDocuments.size} documento/i assegnato/i con successo`);
      setShowAssignDialog(false);
      loadDocuments();
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
      loadDocuments();
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
        <div className="w-full overflow-hidden border rounded-lg">
          <ScrollArea className="h-[300px]">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[45%]">Nome Documento</TableHead>
                  <TableHead className="w-[35%]">Assegnato</TableHead>
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
            <p className="text-sm text-muted-foreground">
              {selectedDocuments.size} documento/i selezionato/i
            </p>
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
                Assegna Documenti
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
