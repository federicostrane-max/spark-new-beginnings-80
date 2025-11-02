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

interface KnowledgeBaseManagerProps {
  agentId: string;
  agentName: string;
}

export const KnowledgeBaseManager = ({ agentId, agentName }: KnowledgeBaseManagerProps) => {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    loadDocuments();
  }, [agentId]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_knowledge")
        .select("id, document_name, category, summary, created_at")
        .eq("agent_id", agentId)
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
      console.log('Starting upload process for:', selectedFile.name);
      
      // Validate file
      if (selectedFile.size > 10 * 1024 * 1024) {
        throw new Error('File is too large (max 10MB)');
      }
      
      // Upload file to Supabase Storage
      const fileName = `${agentId}/${Date.now()}_${selectedFile.name}`;
      console.log('Uploading to storage with filename:', fileName);
      
      const { error: uploadError } = await supabase.storage
        .from('knowledge-pdfs')
        .upload(fileName, selectedFile);
      
      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        throw uploadError;
      }
      
      console.log('File uploaded successfully:', fileName);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('knowledge-pdfs')
        .getPublicUrl(fileName);
      
      console.log('Public URL generated:', publicUrl);
      console.log('Calling process-agent-knowledge...');

      // Call edge function to process the PDF
      const { data, error } = await supabase.functions.invoke('process-agent-knowledge', {
        body: {
          agentId,
          fileUrl: publicUrl,
          fileName: selectedFile.name,
          category: category,
          summary: summary || null
        }
      });

      if (error) {
        console.error('Processing error:', error);
        throw error;
      }
      
      console.log('Document processed successfully:', data);

      toast({ 
        title: "Success", 
        description: `Document uploaded and processed (${data.chunks} chunks)` 
      });
      
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
        .eq("agent_id", agentId)
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
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Knowledge Base for {agentName}</h3>
        <p className="text-sm text-muted-foreground">Manage documents specific to this agent</p>
      </div>
      
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
    </div>
  );
};