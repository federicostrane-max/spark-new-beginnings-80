import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Loader2, FileText, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { chunkText } from "@/lib/textChunking";

interface KnowledgeDocument {
  id: string;
  document_name: string;
  category: string;
  summary: string | null;
  created_at: string;
}

export const KnowledgeBaseManager = () => {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_knowledge")
        .select("id, document_name, category, summary, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      // Group by document_name and get unique documents
      const uniqueDocs = data?.reduce((acc: KnowledgeDocument[], curr) => {
        if (!acc.find(d => d.document_name === curr.document_name)) {
          acc.push(curr);
        }
        return acc;
      }, []) || [];
      
      setDocuments(uniqueDocs);
    } catch (error: any) {
      console.error("Error loading documents:", error);
      toast({ title: "Error", description: "Failed to load documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({ title: "No file selected", variant: "destructive" });
      return;
    }

    if (!category) {
      toast({ title: "Category required", variant: "destructive" });
      return;
    }

    setUploading(true);
    
    try {
      // 1. Upload file to Supabase Storage
      const fileName = `${Date.now()}_${selectedFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('knowledge-pdfs')
        .upload(fileName, selectedFile);
      
      if (uploadError) throw uploadError;

      // 2. Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('knowledge-pdfs')
        .getPublicUrl(fileName);

      // 3. Analyze document
      const { data: analysis, error: analysisError } = await supabase.functions.invoke('analyze-document', {
        body: { 
          fileUrl: publicUrl,
          fileName: selectedFile.name,
          agentId: null
        }
      });

      if (analysisError) throw analysisError;

      // 4. Chunk text
      const chunks = chunkText(analysis.content, 1000, 200);

      // 5. Generate embeddings and insert
      for (const chunk of chunks) {
        const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke('generate-embedding', {
          body: { text: chunk }
        });

        if (embeddingError) throw embeddingError;

        const { error: insertError } = await supabase.from('agent_knowledge').insert({
          document_name: selectedFile.name,
          content: chunk,
          category: category,
          summary: summary || analysis.summary || null,
          embedding: embeddingData.embedding
        });

        if (insertError) throw insertError;
      }

      toast({ title: "Success", description: "Document uploaded successfully!" });
      setSelectedFile(null);
      setCategory("");
      setSummary("");
      loadDocuments();
      
      // Reset file input
      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({ title: "Upload failed", description: error.message || "Failed to upload document", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (documentName: string) => {
    try {
      const { error } = await supabase
        .from("agent_knowledge")
        .delete()
        .eq("document_name", documentName);

      if (error) throw error;

      toast({ title: "Success", description: "Document deleted" });
      loadDocuments();
    } catch (error: any) {
      console.error("Delete error:", error);
      toast({ title: "Error", description: "Failed to delete document", variant: "destructive" });
    }
  };

  return (
    <Tabs defaultValue="upload" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="upload">Upload Document</TabsTrigger>
        <TabsTrigger value="list">Documents List</TabsTrigger>
      </TabsList>

      {/* Upload Tab */}
      <TabsContent value="upload" className="space-y-4 mt-4">
        <div>
          <Label htmlFor="file-upload">Select File (PDF, TXT, DOC)</Label>
          <Input 
            id="file-upload"
            type="file" 
            accept=".pdf,.txt,.doc,.docx" 
            onChange={handleFileChange}
            disabled={uploading}
          />
          {selectedFile && (
            <p className="text-sm text-muted-foreground mt-1">
              Selected: {selectedFile.name}
            </p>
          )}
        </div>
        
        <div>
          <Label htmlFor="category">Category *</Label>
          <Input 
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Marketing, Sales, Technical"
            disabled={uploading}
          />
        </div>

        <div>
          <Label htmlFor="summary">Summary (optional)</Label>
          <Textarea 
            id="summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Brief summary of the document content..."
            rows={3}
            disabled={uploading}
          />
        </div>

        <Button onClick={handleUpload} disabled={uploading || !selectedFile}>
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Upload Document
            </>
          )}
        </Button>
      </TabsContent>

      {/* List Tab */}
      <TabsContent value="list" className="mt-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No documents uploaded yet
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
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
  );
};