import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Copy } from "lucide-react";
import { PDFKnowledgeUpload } from "@/components/PDFKnowledgeUpload";
import { KnowledgeBaseManager } from "@/components/KnowledgeBaseManager";
import { toast } from "sonner";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
  system_prompt: string;
  llm_provider?: string;
}

interface CreateAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (agent: Agent) => void;
  editingAgent?: Agent | null;
  onDelete?: (agentId: string) => void;
}

export const CreateAgentModal = ({ open, onOpenChange, onSuccess, editingAgent, onDelete }: CreateAgentModalProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [llmProvider, setLlmProvider] = useState("anthropic");
  const [loading, setLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);

  // Load agent data when editing
  useEffect(() => {
    if (open && editingAgent) {
      setName(editingAgent.name);
      setDescription(editingAgent.description);
      setSystemPrompt(editingAgent.system_prompt);
      setLlmProvider(editingAgent.llm_provider || "anthropic");
      setCreatedAgentId(editingAgent.id);
    } else if (!open) {
      setName("");
      setDescription("");
      setSystemPrompt("");
      setLlmProvider("anthropic");
      setSelectedFiles([]);
      setCreatedAgentId(null);
    }
  }, [open, editingAgent]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const pdfFiles = files.filter(file => file.type === 'application/pdf');
    
    if (pdfFiles.length !== files.length) {
      console.warn("Solo file PDF sono supportati");
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
      console.warn("Agent name must be at least 3 characters");
      return;
    }

    if (!systemPrompt) {
      console.warn("System prompt required");
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
            llm_provider: llmProvider,
          })
          .eq("id", editingAgent.id)
          .select()
          .single();

        if (error) throw error;

        console.log("Agent updated successfully");
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
            llm_provider: llmProvider,
            avatar: null,
            active: true,
            user_id: user.id
          })
          .select()
          .single();

        if (error) throw error;

        console.log("Agent created successfully");
        
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
    } finally {
      setLoading(false);
    }
  };

  const handleClone = async () => {
    if (!editingAgent) return;
    
    console.log('🔄 [CLONE] Starting clone operation for agent:', {
      id: editingAgent.id,
      name: editingAgent.name,
      llm_provider: editingAgent.llm_provider,
      system_prompt_length: editingAgent.system_prompt?.length,
      description: editingAgent.description
    });
    
    setLoading(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      // Create clone with modified name
      const cloneName = `${editingAgent.name} (Clone)`;
      let cloneSlug = cloneName.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      // Ensure unique slug
      const { data: existing } = await supabase
        .from("agents")
        .select("id")
        .eq("slug", cloneSlug)
        .maybeSingle();
      
      if (existing) {
        cloneSlug = `${cloneSlug}-${Date.now()}`;
        console.log('⚠️ [CLONE] Slug already exists, using:', cloneSlug);
      }

      // Create cloned agent
      console.log('📝 [CLONE] Creating cloned agent with data:', {
        name: cloneName,
        slug: cloneSlug,
        llm_provider: editingAgent.llm_provider,
        system_prompt_length: editingAgent.system_prompt?.length,
        description_length: editingAgent.description?.length
      });

      const { data: clonedAgent, error: cloneError } = await supabase
        .from("agents")
        .insert({
          name: cloneName,
          slug: cloneSlug,
          description: editingAgent.description,
          system_prompt: editingAgent.system_prompt,
          llm_provider: editingAgent.llm_provider,
          avatar: editingAgent.avatar,
          active: true,
          user_id: user.id
        })
        .select()
        .single();

      if (cloneError) throw cloneError;

      console.log('✅ [CLONE] Cloned agent created:', {
        id: clonedAgent.id,
        name: clonedAgent.name,
        llm_provider: clonedAgent.llm_provider,
        system_prompt_matches: clonedAgent.system_prompt === editingAgent.system_prompt,
        system_prompt_length: clonedAgent.system_prompt?.length
      });

      // Clone knowledge base (direct uploads)
      console.log('📚 [CLONE] Fetching direct upload knowledge...');
      const { data: knowledgeItems, error: knowledgeError } = await supabase
        .from("agent_knowledge")
        .select("*")
        .eq("agent_id", editingAgent.id)
        .eq("source_type", "direct_upload");

      if (!knowledgeError && knowledgeItems && knowledgeItems.length > 0) {
        console.log(`📚 [CLONE] Found ${knowledgeItems.length} direct upload knowledge items`);
        
        const clonedKnowledge = knowledgeItems.map(item => ({
          agent_id: clonedAgent.id,
          document_name: item.document_name,
          content: item.content,
          category: item.category,
          summary: item.summary,
          embedding: item.embedding,
          source_type: "direct_upload"
        }));

        const { error: insertKnowledgeError } = await supabase
          .from("agent_knowledge")
          .insert(clonedKnowledge);

        if (insertKnowledgeError) {
          console.error('❌ [CLONE] Error cloning direct knowledge:', insertKnowledgeError);
        } else {
          console.log('✅ [CLONE] Direct knowledge cloned successfully');
        }
      } else {
        console.log('ℹ️ [CLONE] No direct upload knowledge to clone');
      }

      // Clone pool document links
      console.log('🔗 [CLONE] Fetching pool document links...');
      const { data: poolLinks, error: poolLinksError } = await supabase
        .from("agent_document_links")
        .select("*")
        .eq("agent_id", editingAgent.id);

      if (!poolLinksError && poolLinks && poolLinks.length > 0) {
        console.log(`🔗 [CLONE] Found ${poolLinks.length} pool document links`);
        
        const clonedLinks = poolLinks.map(link => ({
          agent_id: clonedAgent.id,
          document_id: link.document_id,
          assignment_type: link.assignment_type,
          assigned_by: user.id,
          confidence_score: link.confidence_score
        }));

        const { error: insertLinksError } = await supabase
          .from("agent_document_links")
          .insert(clonedLinks);

        if (insertLinksError) {
          console.error('❌ [CLONE] Error cloning pool links:', insertLinksError);
        } else {
          console.log('✅ [CLONE] Pool links cloned successfully');
        }

        // Clone pool knowledge chunks
        const poolDocIds = poolLinks.map(l => l.document_id);
        console.log(`📄 [CLONE] Fetching pool knowledge for ${poolDocIds.length} documents...`);
        
        const { data: poolKnowledge } = await supabase
          .from("agent_knowledge")
          .select("*")
          .eq("agent_id", editingAgent.id)
          .eq("source_type", "pool")
          .in("pool_document_id", poolDocIds);

        if (poolKnowledge && poolKnowledge.length > 0) {
          console.log(`📄 [CLONE] Found ${poolKnowledge.length} pool knowledge chunks`);
          
          const clonedPoolKnowledge = poolKnowledge.map(item => ({
            agent_id: clonedAgent.id,
            document_name: item.document_name,
            content: item.content,
            category: item.category,
            summary: item.summary,
            embedding: item.embedding,
            source_type: "pool",
            pool_document_id: item.pool_document_id
          }));

          const { error: insertPoolKnowledgeError } = await supabase
            .from("agent_knowledge")
            .insert(clonedPoolKnowledge);

          if (insertPoolKnowledgeError) {
            console.error('❌ [CLONE] Error cloning pool knowledge:', insertPoolKnowledgeError);
          } else {
            console.log('✅ [CLONE] Pool knowledge cloned successfully');
          }
        } else {
          console.log('ℹ️ [CLONE] No pool knowledge to clone');
        }
      } else {
        console.log('ℹ️ [CLONE] No pool document links to clone');
      }

      // Final verification log
      console.log('✅ [CLONE] Clone operation completed successfully!');
      console.log('📊 [CLONE] Comparison:', {
        original: {
          name: editingAgent.name,
          llm_provider: editingAgent.llm_provider,
          system_prompt_length: editingAgent.system_prompt?.length
        },
        cloned: {
          name: clonedAgent.name,
          llm_provider: clonedAgent.llm_provider,
          system_prompt_length: clonedAgent.system_prompt?.length
        },
        matches: {
          llm_provider: editingAgent.llm_provider === clonedAgent.llm_provider,
          system_prompt: editingAgent.system_prompt === clonedAgent.system_prompt,
          description: editingAgent.description === clonedAgent.description
        }
      });

      toast.success(`Agente "${cloneName}" clonato con successo!`);
      onSuccess(clonedAgent);
      onOpenChange(false);

    } catch (error: any) {
      console.error('❌ [CLONE] Fatal error during cloning:', error);
      toast.error("Errore durante la clonazione dell'agente");
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

        {/* Invisible element to intercept autofocus */}
        <div tabIndex={0} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />

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
              autoFocus={false}
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

          {/* LLM Provider Selection */}
          <div>
            <Label htmlFor="llmProvider">AI Model Provider *</Label>
            <Select 
              value={llmProvider} 
              onValueChange={setLlmProvider}
              disabled={loading}
            >
              <SelectTrigger id="llmProvider">
                <SelectValue placeholder="Select AI provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">
                  <div className="flex flex-col">
                    <span className="font-medium">Anthropic Claude</span>
                    <span className="text-xs text-muted-foreground">Advanced reasoning, high quality</span>
                  </div>
                </SelectItem>
                <SelectItem value="deepseek">
                  <div className="flex flex-col">
                    <span className="font-medium">DeepSeek R1</span>
                    <span className="text-xs text-muted-foreground">Cost-effective, excellent reasoning</span>
                  </div>
                </SelectItem>
                <SelectItem value="openai">
                  <div className="flex flex-col">
                    <span className="font-medium">OpenAI GPT</span>
                    <span className="text-xs text-muted-foreground">Versatile, widely supported</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Choose which AI model will power this agent
            </p>
          </div>

          {/* Knowledge Base Manager - Durante l'editing */}
          {editingAgent && (
            <div className="border rounded-lg p-4">
              <KnowledgeBaseManager 
                agentId={editingAgent.id}
                agentName={editingAgent.name}
              />
            </div>
          )}

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
                  console.log("Knowledge base caricata");
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
            <div className="flex gap-2">
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
              {editingAgent && (
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleClone}
                  disabled={loading}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Clone Agent
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