import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PDFKnowledgeUpload } from "@/components/PDFKnowledgeUpload";

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
  const [loading, setLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

  // Load agent data when editing
  useEffect(() => {
    if (open && editingAgent) {
      setName(editingAgent.name);
      setDescription(editingAgent.description);
      setSystemPrompt(editingAgent.system_prompt);
      setCreatedAgentId(editingAgent.id);
    } else if (!open) {
      setName("");
      setDescription("");
      setSystemPrompt("");
      setSelectedFiles([]);
      setCreatedAgentId(null);
    }
  }, [open, editingAgent]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const pdfFiles = files.filter(file => file.type === 'application/pdf');
    
    if (pdfFiles.length !== files.length) {
      toast({ 
        title: "Solo file PDF", 
        description: "Puoi caricare solo file PDF", 
        variant: "destructive" 
      });
    }
    
    setSelectedFiles(prev => [...prev, ...pdfFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
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

        toast({ title: "Success", description: "Agent updated successfully!" });
        onSuccess(data);
        onOpenChange(false);
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

        toast({ 
          title: "Success", 
          description: "Agent created successfully!" 
        });
        
        // If there are files to upload, set the agent ID for upload
        if (selectedFiles.length > 0) {
          setCreatedAgentId(data.id);
        } else {
          onSuccess(data);
          onOpenChange(false);
        }
      }
      
      // Reset form only if no files to upload
      if (selectedFiles.length === 0) {
        setName("");
        setDescription("");
        setSystemPrompt("");
      }
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

          {/* Knowledge Base Upload - Solo per nuovi agenti */}
          {!editingAgent && !createdAgentId && (
            <div>
              <Label htmlFor="pdfFiles">Knowledge Base (PDF files - Opzionale)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Carica documenti PDF per arricchire la conoscenza dell'agente
              </p>
              <Input
                id="pdfFiles"
                type="file"
                accept="application/pdf"
                multiple
                onChange={handleFileChange}
                disabled={loading}
                className="cursor-pointer"
              />
              {selectedFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {selectedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <span className="truncate">{file.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                        disabled={loading}
                      >
                        Rimuovi
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {!editingAgent && createdAgentId && (
            <div className="space-y-2">
              <Label>Carica Knowledge Base</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Agente creato! Ora carica i documenti PDF
              </p>
              <PDFKnowledgeUpload
                agentId={createdAgentId}
                onUploadComplete={() => {
                  toast({ title: "Successo", description: "Knowledge base caricata!" });
                  setSelectedFiles([]);
                  setCreatedAgentId(null);
                  onSuccess({ id: createdAgentId } as Agent);
                  onOpenChange(false);
                }}
              />
            </div>
          )}

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
                    {editingAgent ? 'Updating...' : 'Creating...'}
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