import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Trash2, FileText } from "lucide-react";
import { PDFKnowledgeUpload } from "./PDFKnowledgeUpload";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";

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

export const KnowledgeBaseManager = ({ agentId, agentName }: KnowledgeBaseManagerProps) => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("upload");
  const [isInitialLoad, setIsInitialLoad] = useState(true);

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
      
      // Switch to list tab ONLY on initial load if there are documents
      if (isInitialLoad && transformedData.length > 0) {
        console.log('📄 Initial load: Switching to list tab');
        setActiveTab("list");
        setIsInitialLoad(false);
      } else if (isInitialLoad) {
        setIsInitialLoad(false);
      }
    } catch (error: any) {
      console.error('❌ Error loading assigned documents:', error);
    } finally {
      setLoading(false);
      console.log('📄 LOAD ASSIGNED DOCUMENTS END');
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Knowledge Base per {agentName}</h3>
        <p className="text-sm text-muted-foreground">Gestisci i documenti specifici per questo agente</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload">Carica Documento</TabsTrigger>
          <TabsTrigger value="list">Lista Documenti</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-4">
          <PDFKnowledgeUpload 
            agentId={agentId} 
            onUploadComplete={loadDocuments}
          />
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nessun documento caricato
            </div>
          ) : (
            <div className="w-full overflow-hidden">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[45%]">Nome Documento</TableHead>
                    <TableHead className="w-[35%]">Creato</TableHead>
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
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
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
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
