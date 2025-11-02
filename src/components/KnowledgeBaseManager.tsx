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
  document_name: string;
  category: string;
  summary: string;
  created_at: string;
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
    console.log('📄 LOAD DOCUMENTS START');
    try {
      setLoading(true);
      
      // Use RPC to get distinct documents efficiently
      const { data, error } = await supabase
        .rpc('get_distinct_documents', { p_agent_id: agentId }) as { 
          data: KnowledgeDocument[] | null, 
          error: any 
        };

      if (error) throw error;

      console.log('📄 LOAD DOCUMENTS SUCCESS, found:', data?.length || 0, 'documents');
      setDocuments(data || []);
      
      // Switch to list tab ONLY on initial load if there are documents
      if (isInitialLoad && data && data.length > 0) {
        console.log('📄 Initial load: Switching to list tab');
        setActiveTab("list");
        setIsInitialLoad(false);
      } else if (isInitialLoad) {
        setIsInitialLoad(false);
      }
    } catch (error: any) {
      console.error('❌ Error loading documents:', error);
    } finally {
      setLoading(false);
      console.log('📄 LOAD DOCUMENTS END');
    }
  };

  const handleDeleteDocument = async (documentName: string) => {
    console.log('🗑️ DELETE START:', documentName);
    try {
      const { error } = await supabase
        .from('agent_knowledge')
        .delete()
        .match({ agent_id: agentId, document_name: documentName });

      if (error) throw error;

      console.log('✅ DELETE SUCCESS, calling loadDocuments...');
      loadDocuments();
      console.log('✅ loadDocuments called');
    } catch (error: any) {
      console.error('❌ Error deleting document:', error);
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
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 min-w-0 max-w-full">
                          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="truncate" title={doc.document_name}>
                            {doc.document_name}
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
                            handleDeleteDocument(doc.document_name);
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
