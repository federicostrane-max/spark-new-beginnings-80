import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { supabase, updateAgentPrompt } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Copy, History, Trash2 } from "lucide-react";
import { PDFKnowledgeUpload } from "@/components/PDFKnowledgeUpload";
import { PromptHistoryDialog } from "@/components/PromptHistoryDialog";
import { AgentTaskRequirementsView } from "@/components/AgentTaskRequirementsView";
import { toast } from "sonner";

// Lazy load heavy component
const KnowledgeBaseManager = lazy(() => import("@/components/KnowledgeBaseManager").then(m => ({ default: m.KnowledgeBaseManager })));
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Helper function to get default model for each provider
const getDefaultModelForProvider = (provider: string): string => {
  switch (provider) {
    case 'deepseek': return 'deepseek-reasoner'; // Most powerful
    case 'google': return 'google/gemini-3-pro-preview';
    case 'anthropic': return 'claude-sonnet-4-20250514';
    case 'openai': return 'gpt-4o';
    case 'mistral': return 'mistral-large-latest';
    case 'x-ai': return 'grok-2-latest';
    case 'openrouter': return 'deepseek/deepseek-chat';
    default: return '';
  }
};

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
  system_prompt: string;
  llm_provider?: string;
  ai_model?: string;
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
  const [aiModel, setAiModel] = useState<string>("");
  const [prevProvider, setPrevProvider] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
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
      const provider = editingAgent.llm_provider || "anthropic";
      setLlmProvider(provider);
      const defaultModel = getDefaultModelForProvider(provider);
      setAiModel(editingAgent.ai_model || defaultModel);
      previousPromptRef.current = editingAgent.system_prompt;
    } else if (!open) {
      // Reset quando il modale si chiude
      setName("");
      setDescription("");
      setSystemPrompt("");
      setLlmProvider("anthropic");
      setAiModel("");
      isEditingRef.current = false;
      previousPromptRef.current = "";
    }
  }, [open]);

  // Auto-set default model when provider changes
  useEffect(() => {
    if (llmProvider) {
      // Se il provider è cambiato, aggiorna il modello al default del nuovo provider
      if (prevProvider && prevProvider !== llmProvider) {
        const defaultModel = getDefaultModelForProvider(llmProvider);
        setAiModel(defaultModel);
      }
      // Se non c'è modello, imposta il default
      else if (!aiModel || aiModel === '') {
        const defaultModel = getDefaultModelForProvider(llmProvider);
        setAiModel(defaultModel);
      }
      setPrevProvider(llmProvider);
    }
  }, [llmProvider, prevProvider, aiModel]);

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
        console.log("[CreateAgentModal] Updating agent:", {
          id: editingAgent.id,
          name,
          newPromptLength: systemPrompt.length,
          oldPromptLength: previousPromptRef.current.length,
          promptChanged: previousPromptRef.current !== systemPrompt
        });

        // Check if prompt has changed
        const promptChanged = previousPromptRef.current !== systemPrompt;

        // Get current user for claiming legacy agents
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("User not authenticated");

        // Update agent metadata directly via Supabase
        // RLS policy now allows updating legacy agents (user_id = NULL)
        // We also "claim" legacy agents by setting user_id
        const updateData: Record<string, unknown> = {
          name,
          description: description || "",
          llm_provider: llmProvider,
          ai_model: aiModel || getDefaultModelForProvider(llmProvider),
        };

        // Claim legacy agent if it has no user_id
        const { data: currentAgent } = await supabase
          .from("agents")
          .select("user_id")
          .eq("id", editingAgent.id)
          .single();

        if (!currentAgent?.user_id) {
          updateData.user_id = user.id;
          console.log("[CreateAgentModal] Claiming legacy agent for user:", user.id);
        }

        const { data: metadataUpdate, error: metadataError } = await supabase
          .from("agents")
          .update(updateData)
          .eq("id", editingAgent.id)
          .select()
          .single();

        if (metadataError) {
          console.error("[CreateAgentModal] Error updating agent metadata:", metadataError);
          toast.error("Errore durante il salvataggio dei metadati dell'agente");
          throw metadataError;
        }
        let finalData: Agent = metadataUpdate;
        // If prompt changed, use the update-agent-prompt function to update it
        if (promptChanged) {
          console.log("[CreateAgentModal] Prompt changed, using update-agent-prompt function");
          
          const { data: promptUpdateData, error: promptError } = await updateAgentPrompt(
            editingAgent.id,
            systemPrompt,
            user.id
          );

          if (promptError) {
            console.error("[CreateAgentModal] Error updating prompt via function:", promptError);
            toast.error("Errore durante l'aggiornamento del prompt");
            throw promptError;
          }

          console.log("[CreateAgentModal] Prompt updated via function:", promptUpdateData);

          // Avoid refetch (can fail on legacy RLS / ownership). We already know the new prompt.
          finalData = {
            ...metadataUpdate,
            system_prompt: systemPrompt,
          };
        } else {
          console.log("[CreateAgentModal] Prompt unchanged, skipping update-agent-prompt");
        }

        console.log("[CreateAgentModal] ✅ Agent updated successfully");
        previousPromptRef.current = systemPrompt; // Update ref after successful save
        toast.success("Agente aggiornato con successo!");
        
        // Call onSuccess immediately (no delay)
        onSuccess(finalData);
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
            ai_model: aiModel || getDefaultModelForProvider(llmProvider),
            avatar: null,
            active: true,
            user_id: user.id
          })
          .select()
          .single();

        if (error) throw error;

        console.log("[CreateAgentModal] Agent created successfully:", data);
        
        // Callback FIRST to trigger parent updates
        onSuccess(data);
        
        // Then close modal and reset form with a delay to ensure UI updates
        setTimeout(() => {
          onOpenChange(false);
          
          // Reset form
          setName("");
          setDescription("");
          setSystemPrompt("");
          
          console.log("[CreateAgentModal] Modal closed, agent should appear in sidebar");
        }, 150);
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

      // Knowledge cloning removed - legacy tables deleted
      console.log('⚠️ [CLONE] Knowledge cloning not available - legacy system removed');

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
                <SelectItem value="google">
                  <div className="flex flex-col">
                    <span className="font-medium">Google Gemini</span>
                    <span className="text-xs text-muted-foreground">Multimodal, fast, cost-effective</span>
                  </div>
                </SelectItem>
                <SelectItem value="deepseek">
                  <div className="flex flex-col">
                    <span className="font-medium">DeepSeek Reasoner</span>
                    <span className="text-xs text-muted-foreground">Reasoning profondo con Chain-of-Thought • Economico</span>
                  </div>
                </SelectItem>
                <SelectItem value="openai">
                  <div className="flex flex-col">
                    <span className="font-medium">OpenAI GPT</span>
                    <span className="text-xs text-muted-foreground">Versatile, widely supported</span>
                  </div>
                </SelectItem>
                <SelectItem value="mistral">
                  <div className="flex flex-col">
                    <span className="font-medium">Mistral AI</span>
                    <span className="text-xs text-muted-foreground">European AI, efficient, multilingual</span>
                  </div>
                </SelectItem>
                <SelectItem value="x-ai">
                  <div className="flex flex-col">
                    <span className="font-medium">xAI Grok</span>
                    <span className="text-xs text-muted-foreground">Real-time info, humor, latest tech</span>
                  </div>
                </SelectItem>
                <SelectItem value="openrouter">
                  <div className="flex flex-col">
                    <span className="font-medium">OpenRouter</span>
                    <span className="text-xs text-muted-foreground">Access to 100+ models (GPT, Claude, Gemini, Kimi, etc.)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Choose which AI model will power this agent
            </p>
          </div>

          {/* DeepSeek Model Selection */}
          {llmProvider === 'deepseek' && (
            <div>
              <Label htmlFor="aiModel">DeepSeek Model *</Label>
              <Select 
                value={aiModel || 'deepseek-reasoner'} 
                onValueChange={setAiModel}
                disabled={loading}
              >
                <SelectTrigger id="aiModel">
                  <SelectValue placeholder="Select DeepSeek model" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="deepseek-reasoner">
                    <div className="flex flex-col">
                      <span className="font-medium">DeepSeek Reasoner</span>
                      <span className="text-xs text-muted-foreground">Reasoning profondo con Chain-of-Thought esplicito • Migliore per analisi complesse</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="deepseek-chat">
                    <div className="flex flex-col">
                      <span className="font-medium">DeepSeek Chat</span>
                      <span className="text-xs text-muted-foreground">Conversazione veloce • Economico</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Reasoner include &lt;think&gt; tags per mostrare il ragionamento step-by-step
              </p>
            </div>
          )}

          {/* Google Gemini Model Selection */}
          {llmProvider === 'google' && (
            <div>
              <Label htmlFor="aiModel">Google Gemini Model *</Label>
              <Select 
                value={aiModel || 'google/gemini-2.5-flash'} 
                onValueChange={setAiModel}
                disabled={loading}
              >
                <SelectTrigger id="aiModel">
                  <SelectValue placeholder="Select Gemini model" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="google/gemini-2.5-flash">
                    <div className="flex flex-col">
                      <span className="font-medium">Gemini 2.5 Flash</span>
                      <span className="text-xs text-muted-foreground">Balanced and fast [Default]</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="google/gemini-2.5-pro">
                    <div className="flex flex-col">
                      <span className="font-medium">Gemini 2.5 Pro</span>
                      <span className="text-xs text-muted-foreground">Top tier for complex reasoning</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="google/gemini-3-pro-preview">
                    <div className="flex flex-col">
                      <span className="font-medium">Gemini 3 Pro Preview</span>
                      <span className="text-xs text-muted-foreground">Next-generation, advanced reasoning</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="google/gemini-3-pro-image-preview">
                    <div className="flex flex-col">
                      <span className="font-medium">Gemini 3 Pro Image Preview</span>
                      <span className="text-xs text-muted-foreground">Next-gen image generation</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="google/gemini-2.5-flash-lite">
                    <div className="flex flex-col">
                      <span className="font-medium">Gemini 2.5 Flash Lite</span>
                      <span className="text-xs text-muted-foreground">Fastest and most economical</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Mistral Model Selection */}
          {llmProvider === 'mistral' && (
            <div>
              <Label htmlFor="aiModel">Mistral Model *</Label>
              <Select 
                value={aiModel || 'mistral-large-latest'} 
                onValueChange={setAiModel}
                disabled={loading}
              >
                <SelectTrigger id="aiModel">
                  <SelectValue placeholder="Select Mistral model" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="mistral-large-latest">
                    <div className="flex flex-col">
                      <span className="font-medium">Mistral Large</span>
                      <span className="text-xs text-muted-foreground">Most capable, complex tasks</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="mistral-medium-latest">
                    <div className="flex flex-col">
                      <span className="font-medium">Mistral Medium</span>
                      <span className="text-xs text-muted-foreground">Balanced performance</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="mistral-small-latest">
                    <div className="flex flex-col">
                      <span className="font-medium">Mistral Small</span>
                      <span className="text-xs text-muted-foreground">Fast, cost-effective</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* xAI Grok Model Selection */}
          {llmProvider === 'x-ai' && (
            <div>
              <Label htmlFor="aiModel">xAI Grok Model *</Label>
              <Select 
                value={aiModel || 'grok-beta'} 
                onValueChange={setAiModel}
                disabled={loading}
              >
                <SelectTrigger id="aiModel">
                  <SelectValue placeholder="Select Grok model" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  <SelectItem value="grok-beta">
                    <div className="flex flex-col">
                      <span className="font-medium">Grok Beta</span>
                      <span className="text-xs text-muted-foreground">Latest Grok with real-time info</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="grok-vision-beta">
                    <div className="flex flex-col">
                      <span className="font-medium">Grok Vision Beta</span>
                      <span className="text-xs text-muted-foreground">Multimodal with vision</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* OpenRouter Model Selection */}
          {llmProvider === 'openrouter' && (
            <div>
              <Label htmlFor="aiModel">AI Model *</Label>
              <Select 
                value={aiModel} 
                onValueChange={setAiModel}
                disabled={loading}
              >
                <SelectTrigger id="aiModel">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent className="bg-background z-50 max-h-[300px] overflow-y-auto">
                  <SelectItem value="deepseek/deepseek-chat">
                    <div className="flex flex-col">
                      <span className="font-medium">DeepSeek Chat</span>
                      <span className="text-xs text-muted-foreground">Cost-effective, excellent reasoning</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="moonshot/kimi-k1.5">
                    <div className="flex flex-col">
                      <span className="font-medium">Kimi K1.5</span>
                      <span className="text-xs text-muted-foreground">Long context, multilingual</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="anthropic/claude-3.5-sonnet">
                    <div className="flex flex-col">
                      <span className="font-medium">Claude 3.5 Sonnet</span>
                      <span className="text-xs text-muted-foreground">Advanced reasoning, high quality</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="anthropic/claude-3-opus">
                    <div className="flex flex-col">
                      <span className="font-medium">Claude 3 Opus</span>
                      <span className="text-xs text-muted-foreground">Most capable, slower</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="openai/gpt-4-turbo">
                    <div className="flex flex-col">
                      <span className="font-medium">GPT-4 Turbo</span>
                      <span className="text-xs text-muted-foreground">Latest GPT-4, 128K context</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="openai/gpt-4o">
                    <div className="flex flex-col">
                      <span className="font-medium">GPT-4o</span>
                      <span className="text-xs text-muted-foreground">Faster GPT-4 variant</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="google/gemini-pro-1.5">
                    <div className="flex flex-col">
                      <span className="font-medium">Gemini 1.5 Pro</span>
                      <span className="text-xs text-muted-foreground">Google's best, 2M context</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="meta-llama/llama-3.1-70b-instruct">
                    <div className="flex flex-col">
                      <span className="font-medium">Llama 3.1 70B</span>
                      <span className="text-xs text-muted-foreground">Open-source, powerful</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="perplexity/llama-3.1-sonar-large-128k-online">
                    <div className="flex flex-col">
                      <span className="font-medium">Perplexity Sonar (Online)</span>
                      <span className="text-xs text-muted-foreground">Web search built-in</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Select the specific AI model to use via OpenRouter
              </p>
            </div>
          )}

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

          {/* Task Requirements - Durante l'editing */}
          {editingAgent && (
            <div className="space-y-4">
              <AgentTaskRequirementsView 
                agentId={editingAgent.id}
                systemPrompt={systemPrompt}
              />
            </div>
          )}

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
          <div className="flex gap-2 justify-between items-center">
            {/* Sinistra: Delete Agent */}
            <div>
              {editingAgent && onDelete && (
                <Button 
                  type="button" 
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={loading}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Agent
                </Button>
              )}
            </div>

            {/* Destra: Altre azioni */}
            <div className="flex gap-2">
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Elimina Agente
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Sei sicuro di voler eliminare questo agente? Questa azione non può essere annullata.
              </p>
              <div className="text-sm space-y-1 pl-4 border-l-2 border-destructive/50">
                <p>• Tutte le conversazioni con questo agente andranno perse</p>
                <p>• I documenti assegnati rimarranno nel pool e non verranno eliminati</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (editingAgent && onDelete) {
                  onDelete(editingAgent.id);
                  onOpenChange(false);
                  setShowDeleteDialog(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Elimina Definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};