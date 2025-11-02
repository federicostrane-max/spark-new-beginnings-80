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
import { extractTextFromPDF, validatePDFFile } from "@/lib/pdfExtraction";
import * as pdfjsLib from 'pdfjs-dist';

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
  editingAgent?: Agent | null;
  onDelete?: (agentId: string) => void;
}

export const CreateAgentModal = ({ open, onOpenChange, onSuccess, editingAgent, onDelete }: CreateAgentModalProps) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);

  // Load agent data when editing
  useEffect(() => {
    if (open && editingAgent) {
      setName(editingAgent.name);
      setDescription(editingAgent.description);
      setSystemPrompt(editingAgent.system_prompt);
      setPdfFiles([]);
    } else if (!open) {
      setName("");
      setDescription("");
      setSystemPrompt("");
      setPdfFiles([]);
    }
  }, [open, editingAgent]);

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
        // Validate PDF
        const validation = validatePDFFile(file, 10);
        if (!validation.valid) {
          throw new Error(validation.error);
        }

        toast({ 
          title: `Processing ${file.name}...`, 
          description: `Extracting text from PDF` 
        });

        // Extract text from PDF
        const text = await extractTextFromPDF(file);
        
        if (!text || text.length < 10) {
          throw new Error('PDF is empty or unreadable');
        }

        // Chunk the text
        const chunks = chunkText(text, 1000, 200);

        toast({ 
          title: `Processing ${file.name}...`, 
          description: `Creating ${chunks.length} knowledge chunks...` 
        });

        // Call edge function to process chunks
        const { data, error } = await supabase.functions.invoke('process-chunks', {
          body: {
            chunks: chunks,
            agentId: agentId,
            fileName: file.name,
            category: 'uploaded',
            summary: description || null
          }
        });

        if (error) {
          throw new Error(`Failed to process chunks: ${error.message}`);
        }

        if (!data || !data.success) {
          throw new Error('Processing failed');
        }

        toast({ 
          title: "Success", 
          description: `${file.name} processed successfully (${data.chunks} chunks)` 
        });

      } catch (error) {
        console.error('Error processing PDF:', error);
        toast({ 
          title: "Error processing PDF", 
          description: `${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          variant: "destructive" 
        });
        throw error;
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
      if (editingAgent) {
        // Update existing agent
        const { data, error } = await supabase
          .from("agents")
          .update({
            name,
            description,
            system_prompt: systemPrompt,
          })
          .eq("id", editingAgent.id)
          .select()
          .single();

        if (error) throw error;

        // Process PDF files if present
        if (pdfFiles.length > 0) {
          toast({ title: "Processing documents...", description: "Agent updated, uploading knowledge base..." });
          try {
            await processPDFsForAgent(data.id, pdfFiles);
          } catch (pdfError) {
            toast({
              title: "PDF Processing Failed",
              description: pdfError instanceof Error ? pdfError.message : "Unknown error processing PDFs",
              variant: "destructive"
            });
            throw pdfError;
          }
        }

        toast({ title: "Success", description: "Agent updated successfully!" });
        onSuccess(data);
      } else {
        // Create new agent
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

        // Process PDF files BEFORE closing modal
        if (pdfFiles.length > 0) {
          toast({ 
            title: "Processing PDFs...", 
            description: `Starting to process ${pdfFiles.length} file(s)...` 
          });
          
          try {
            await processPDFsForAgent(data.id, pdfFiles);
          } catch (pdfError) {
            toast({
              title: "PDF Processing Failed",
              description: pdfError instanceof Error ? pdfError.message : "Unknown error processing PDFs",
              variant: "destructive"
            });
            // Don't throw error - allow agent to be created anyway
          }
        }

        toast({ 
          title: "Success", 
          description: pdfFiles.length > 0 
            ? "Agent created and documents processed successfully!" 
            : "Agent created successfully!" 
        });
        onSuccess(data);
      }
      
      // Close modal after everything is complete
      onOpenChange(false);
      
      // Reset form
      setName("");
      setDescription("");
      setSystemPrompt("");
      setPdfFiles([]);
    } catch (error: any) {
      console.error(`Error ${editingAgent ? 'updating' : 'creating'} agent:`, error);
      toast({ title: "Error", description: error.message || `Failed to ${editingAgent ? 'update' : 'create'} agent`, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingAgent ? 'Edit Agent' : 'Create New Agent'}</DialogTitle>
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
          <div className="flex gap-2 justify-between">
            <div>
              {editingAgent && onDelete && (
                <Button 
                  type="button" 
                  variant="destructive" 
                  onClick={() => {
                    onDelete(editingAgent.id);
                    onOpenChange(false);
                  }}
                  disabled={loading}
                >
                  Delete Agent
                </Button>
              )}
            </div>
            <div className="flex gap-2">
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
                    {pdfFiles.length > 0 
                      ? `${editingAgent ? 'Updating' : 'Creating'} agent and processing documents...` 
                      : `${editingAgent ? 'Updating' : 'Creating'}...`}
                  </>
                ) : (
                  editingAgent ? "Update Agent" : "Create Agent"
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};