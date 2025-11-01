import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { chunkText } from "@/lib/textChunking";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
  system_prompt: string;
}

interface CreateAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (agent: Agent) => void;
}

export const CreateAgentModal = ({ open, onOpenChange, onSuccess }: CreateAgentModalProps) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setSystemPrompt("");
      setPdfFiles([]);
    }
  }, [open]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setPdfFiles(prev => [...prev, ...Array.from(files)]);
    }
  };

  const removeFile = (index: number) => {
    setPdfFiles(prev => prev.filter((_, i) => i !== index));
  };

  const processPDFsForAgent = async (agentId: string, files: File[]) => {
    for (const file of files) {
      try {
        // Upload to Supabase Storage
        const fileName = `${agentId}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('knowledge-pdfs')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('knowledge-pdfs')
          .getPublicUrl(fileName);

        // Read file as text (for PDF we'd normally use a library, but for demo we'll use FileReader)
        const fileContent = await file.text();

        // Chunk text
        const chunks = chunkText(fileContent, 1000, 200);

        // Generate embeddings and insert
        for (const chunk of chunks) {
          const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke('generate-embedding', {
            body: { text: chunk }
          });

          if (embeddingError) throw embeddingError;

          await supabase.from('agent_knowledge').insert({
            agent_id: agentId,
            document_name: file.name,
            content: chunk,
            category: 'uploaded',
            summary: null,
            embedding: embeddingData.embedding
          });
        }
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        toast({ 
          title: "Warning", 
          description: `Failed to process ${file.name}. Agent created but knowledge base incomplete.`,
          variant: "destructive" 
        });
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!name || name.length < 3) {
      toast({ title: "Name too short", description: "Agent name must be at least 3 characters", variant: "destructive" });
      return;
    }

    if (!systemPrompt) {
      toast({ title: "System prompt required", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // Auto-generate slug
      let autoSlug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      // Check slug uniqueness
      const { data: existing } = await supabase
        .from("agents")
        .select("id")
        .eq("slug", autoSlug)
        .maybeSingle();
      
      if (existing) {
        // Append timestamp to make it unique
        autoSlug = `${autoSlug}-${Date.now()}`;
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Create agent
      const { data, error } = await supabase
        .from("agents")
        .insert({
          name,
          slug: autoSlug,
          description,
          system_prompt: systemPrompt,
          avatar: null,
          active: true,
          user_id: user.id
        })
        .select()
        .single();

      if (error) throw error;

      // Process PDF files if present
      if (pdfFiles.length > 0) {
        toast({ title: "Processing documents...", description: "Agent created, uploading knowledge base..." });
        await processPDFsForAgent(data.id, pdfFiles);
      }

      toast({ title: "Success", description: "Agent created successfully!" });
      onSuccess(data);
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating agent:", error);
      toast({ title: "Error", description: error.message || "Failed to create agent", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Agent</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <Label htmlFor="name">Agent Name *</Label>
            <Input 
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing Guru"
              required
              disabled={loading}
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea 
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this agent specializes in..."
              rows={3}
              disabled={loading}
            />
          </div>

          {/* System Prompt */}
          <div>
            <Label htmlFor="systemPrompt">System Prompt *</Label>
            <Textarea 
              id="systemPrompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a marketing expert specialized in..."
              rows={6}
              className="font-mono text-sm"
              required
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Define the agent's personality, expertise, and behavior
            </p>
          </div>

          {/* Knowledge Base PDF Upload */}
          <div>
            <Label htmlFor="pdf-upload">Knowledge Base (PDF files)</Label>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <Input 
                id="pdf-upload"
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileChange}
                disabled={loading}
                className="hidden"
              />
              <label 
                htmlFor="pdf-upload" 
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Click to upload PDF documents
                </p>
              </label>
              
              {pdfFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {pdfFiles.map((file, index) => (
                    <div 
                      key={index} 
                      className="flex items-center justify-between bg-muted p-2 rounded text-sm"
                    >
                      <span className="truncate">📄 {file.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                        disabled={loading}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-2 justify-end">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {pdfFiles.length > 0 ? "Creating agent and processing documents..." : "Creating..."}
                </>
              ) : (
                "Create Agent"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};