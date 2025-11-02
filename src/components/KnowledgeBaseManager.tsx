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

  useEffect(() => {
    loadDocuments();
  }, [agentId]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      
      // Get distinct document names instead of all chunks
      const { data, error } = await supabase
        .from('agent_knowledge')
        .select('id, document_name, category, summary, created_at')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(10000); // High limit to get all chunks

      if (error) throw error;

      console.log(`📚 Raw data from DB (${data?.length} rows):`, data?.map(d => d.document_name));

      // Group by exact document name to show unique documents
      const uniqueDocs = new Map<string, KnowledgeDocument>();
      data?.forEach(doc => {
        if (!uniqueDocs.has(doc.document_name)) {
          uniqueDocs.set(doc.document_name, doc);
        }
      });

      const uniqueDocsArray = Array.from(uniqueDocs.values());
      console.log(`📚 Unique documents (${uniqueDocsArray.length}):`, uniqueDocsArray.map(d => d.document_name));
      
      setDocuments(uniqueDocsArray);
    } catch (error: any) {
      console.error('Error loading documents:', error);
      toast.error("Errore nel caricamento dei documenti");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDocument = async (documentName: string) => {
    try {
      const { error } = await supabase
        .from('agent_knowledge')
        .delete()
        .match({ agent_id: agentId, document_name: documentName });

      if (error) throw error;

      toast.success("Documento eliminato");
      loadDocuments();
    } catch (error: any) {
      console.error('Error deleting document:', error);
      toast.error("Errore durante l'eliminazione");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Knowledge Base per {agentName}</h3>
        <p className="text-sm text-muted-foreground">Gestisci i documenti specifici per questo agente</p>
      </div>

      <Tabs defaultValue="upload" className="w-full">
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome Documento</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Creato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {doc.document_name}
                      </div>
                    </TableCell>
                    <TableCell>{doc.category}</TableCell>
                    <TableCell>
                      {formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleDeleteDocument(doc.document_name)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
