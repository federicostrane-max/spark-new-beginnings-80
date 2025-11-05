import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Copy, History } from "lucide-react";
import { PDFKnowledgeUpload } from "@/components/PDFKnowledgeUpload";
import { KnowledgeBaseManager } from "@/components/KnowledgeBaseManager";
import { PromptHistoryDialog } from "@/components/PromptHistoryDialog";
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
  onDocsUpdated?: () => void;
}

export const CreateAgentModal = ({ open, onOpenChange, onSuccess, editingAgent, onDelete, onDocsUpdated }: CreateAgentModalProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [llmProvider, setLlmProvider] = useState("anthropic");
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const isEditingRef = useRef(false);
  const previousPromptRef = useRef<string>("");

  // Load agent data when editing
  useEffect(() => {
    if (open && editingAgent && !isEditingRef.current) {
      // Prima apertura del modale con questo agente
      isEditingRef.current = true;
      setName(editingAgent.name);
      setDescription(editingAgent.description);
      setSystemPrompt(editingAgent.system_prompt);
      setLlmProvider(editingAgent.llm_provider || "anthropic");
      previousPromptRef.current = editingAgent.system_prompt;
    } else if (!open) {
      // Reset quando il modale si chiude
      setName("");
      setDescription("");
      setSystemPrompt("");
      setLlmProvider("anthropic");
      isEditingRef.current = false;
      previousPromptRef.current = "";
    }
  }, [open]);

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
        // Save to history if prompt changed
        if (systemPrompt !== previousPromptRef.current) {
          await savePromptToHistory(editingAgent.id, previousPromptRef.current);
        }

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
        previousPromptRef.current = systemPrompt; // Update ref after save
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
        
        onSuccess(data);
        onOpenChange(false);
        
        // Reset form
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

  const savePromptToHistory = async (agentId: string, prompt: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Get the current max version number
      const { data: maxVersion } = await supabase
        .from("agent_prompt_history")
        .select("version_number")
        .eq("agent_id", agentId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (maxVersion?.version_number || 0) + 1;

      const { error } = await supabase
        .from("agent_prompt_history")
        .insert({
          agent_id: agentId,
          system_prompt: prompt,
          created_by: user?.id || null,
          version_number: nextVersion
        });

      if (error) {
        console.error("Error saving prompt to history:", error);
      } else {
        console.log(`Prompt version ${nextVersion} saved to history`);
      }
    } catch (error) {
      console.error("Error in savePromptToHistory:", error);
    }
  };

  const handleRestorePrompt = (prompt: string) => {
    setSystemPrompt(prompt);
    toast.info("Prompt ripristinato. Salva l'agente per applicare le modifiche.");
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
      const cloneName = `${editingAgent.name} (copy)`;
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

      // Clone knowledge base (direct uploads and any non-pool documents)
      console.log('📚 [CLONE] Fetching all knowledge (direct uploads + NULL source_type)...');
      
      // First, check ALL knowledge items for debugging
      const { data: allKnowledge, error: allKnowledgeError } = await supabase
        .from("agent_knowledge")
        .select("id, document_name, source_type, pool_document_id")
        .eq("agent_id", editingAgent.id);
      
      if (allKnowledge) {
        console.log(`🔍 [CLONE DEBUG] Total knowledge items in original agent: ${allKnowledge.length}`);
        console.log('🔍 [CLONE DEBUG] Source types breakdown:', 
          allKnowledge.reduce((acc, item) => {
            const type = item.source_type || 'NULL';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        );
      }
      
      // Fetch non-pool documents (direct_upload or NULL)
      const { data: knowledgeItems, error: knowledgeError } = await supabase
        .from("agent_knowledge")
        .select("*")
        .eq("agent_id", editingAgent.id)
        .or("source_type.eq.direct_upload,source_type.is.null");

      if (knowledgeError) {
        console.error('❌ [CLONE] Error fetching knowledge:', knowledgeError);
        console.error('❌ [CLONE] Error details:', {
          message: knowledgeError.message,
          code: knowledgeError.code,
          details: knowledgeError.details,
          hint: knowledgeError.hint
        });
      }

      if (!knowledgeError && knowledgeItems && knowledgeItems.length > 0) {
        console.log(`📚 [CLONE] Found ${knowledgeItems.length} direct upload knowledge items to clone`);
        console.log('📚 [CLONE] Documents to clone:', knowledgeItems.map(k => ({
          name: k.document_name,
          source_type: k.source_type,
          has_embedding: !!k.embedding
        })));
        
        const clonedKnowledge = knowledgeItems.map(item => ({
          agent_id: clonedAgent.id,
          document_name: item.document_name,
          content: item.content,
          category: item.category,
          summary: item.summary,
          embedding: item.embedding,
          source_type: item.source_type || "direct_upload"
        }));

        console.log(`💾 [CLONE] Attempting to insert ${clonedKnowledge.length} knowledge items...`);
        const { data: insertedData, error: insertKnowledgeError } = await supabase
          .from("agent_knowledge")
          .insert(clonedKnowledge)
          .select();

        if (insertKnowledgeError) {
          console.error('❌ [CLONE] Error cloning direct knowledge:', insertKnowledgeError);
          console.error('❌ [CLONE] Insert error details:', {
            message: insertKnowledgeError.message,
            code: insertKnowledgeError.code,
            details: insertKnowledgeError.details,
            hint: insertKnowledgeError.hint
          });
        } else {
          console.log(`✅ [CLONE] Direct knowledge cloned successfully! Inserted ${insertedData?.length || 0} items`);
        }
      } else {
        console.warn('⚠️ [CLONE] No direct upload knowledge to clone!');
        if (allKnowledge && allKnowledge.length > 0) {
          console.warn('⚠️ [CLONE] Original agent HAS knowledge but none matched the filter!');
        }
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

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="systemPrompt">System Prompt *</Label>
              {editingAgent && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHistory(true)}
                  className="gap-2"
                  disabled={loading}
                >
                  <History className="w-4 h-4" />
                  Cronologia
                </Button>
              )}
            </div>
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

          {/* Knowledge Base Manager - Durante l'editing */}
          {editingAgent && (
            <div className="border rounded-lg p-4">
              <KnowledgeBaseManager 
                agentId={editingAgent.id}
                agentName={editingAgent.name}
                onDocsUpdated={onDocsUpdated}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <div className="flex gap-2 justify-end">
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
            
            {editingAgent && onDelete && (
              <Button 
                type="button" 
                variant="destructive" 
                onClick={() => {
                  onDelete(editingAgent.id);
                  onOpenChange(false);
                }}
                disabled={loading}
                className="w-full"
              >
                Delete Agent
              </Button>
            )}
          </div>
        </form>

        {/* Prompt History Dialog */}
        {editingAgent && (
          <PromptHistoryDialog
            open={showHistory}
            onOpenChange={setShowHistory}
            agentId={editingAgent.id}
            onRestore={handleRestorePrompt}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};