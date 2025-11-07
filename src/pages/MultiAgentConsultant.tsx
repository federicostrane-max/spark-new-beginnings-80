import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTTS } from "@/contexts/TTSContext";
import { useAgentHealth } from "@/hooks/useAgentHealth";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { AgentsSidebar } from "@/components/AgentsSidebar";
import { GlobalAlerts } from "@/components/GlobalAlerts";
import { ExportChatPDF } from "@/components/ExportChatPDF";
import { CreateAgentModal } from "@/components/CreateAgentModal";
import { ForwardMessageDialog } from "@/components/ForwardMessageDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Menu, Forward, X, Edit, ChevronsDown, ChevronsUp, Trash2, Database, AlertCircle } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
  system_prompt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  llm_provider?: string;
}

interface Conversation {
  id: string;
  agent_id: string;
  title: string;
}

export default function MultiAgentConsultant() {
  const { session } = useAuth();
  const { preGenerateAudio } = useTTS();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [allMessagesExpanded, setAllMessagesExpanded] = useState<boolean>(false);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const [unsyncedDocsCount, setUnsyncedDocsCount] = useState(0);
  const [agentUpdateTrigger, setAgentUpdateTrigger] = useState(0);
  const [activeLongResponse, setActiveLongResponse] = useState<string | null>(null);
  const [backgroundProgress, setBackgroundProgress] = useState<{
    totalChars: number;
    chunks: number;
    status: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();

  // Monitora la salute di tutti gli agenti per mostrare gli alert globali
  const agentHealth = useAgentHealth(agents.map(a => a.id));

  // Intelligent auto-scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    setIsUserAtBottom(distanceFromBottom < 50);
    
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setIsUserAtBottom(true);
    }, 3000);
  };

  useEffect(() => {
    if (isUserAtBottom && !streamingConversationId) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isUserAtBottom, streamingConversationId]);

  // Pre-generate audio for assistant messages when streaming stops
  useEffect(() => {
    if (!streamingConversationId && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant' && lastMessage.content.trim()) {
        // Pre-generate audio in background
        preGenerateAudio(lastMessage.id, lastMessage.content);
      }
    }
  }, [streamingConversationId, messages, preGenerateAudio]);

  // Realtime subscription for long responses
  useEffect(() => {
    if (!currentConversation?.id) return;
    
    console.log('[REALTIME] Setting up long response subscription for conversation:', currentConversation.id);
    
    const channel = supabase
      .channel(`long-response-${currentConversation.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_long_responses',
          filter: `conversation_id=eq.${currentConversation.id}`
        },
        (payload) => {
          console.log('📡 [REALTIME] Long response update:', payload.eventType, payload.new);
          
          if (payload.eventType === 'INSERT') {
            setActiveLongResponse(payload.new.id);
            setBackgroundProgress({
              totalChars: payload.new.total_characters,
              chunks: payload.new.current_chunk_index,
              status: payload.new.status
            });
          } else if (payload.eventType === 'UPDATE') {
            const data = payload.new;
            setBackgroundProgress({
              totalChars: data.total_characters,
              chunks: data.current_chunk_index,
              status: data.status
            });
            
            // Update message in real-time
            if (data.status === 'generating' || data.status === 'completed') {
              const fullText = data.response_chunks
                .map((c: any) => c.chunk)
                .join('');
              
              setMessages(prev => prev.map(msg => 
                msg.id === data.message_id
                  ? { ...msg, content: fullText }
                  : msg
              ));
            }
            
            // Cleanup when completed
            if (data.status === 'completed' || data.status === 'failed') {
              setTimeout(() => {
                setActiveLongResponse(null);
                setBackgroundProgress(null);
              }, 3000);
            }
          }
        }
      )
      .subscribe();
    
    return () => {
      console.log('[REALTIME] Cleaning up long response subscription');
      supabase.removeChannel(channel);
    };
  }, [currentConversation?.id]);


  // Reload messages when returning to the app
  useEffect(() => {
    const reloadMessages = () => {
      if (currentConversation?.id && !streamingConversationId) {
        loadConversation(currentConversation.id);
      }
    };

    // Reload when window regains focus (user returns to app)
    window.addEventListener('focus', reloadMessages);
    
    // Also reload on visibility change (mobile)
    const handleVisibilityChange = () => {
      if (!document.hidden && currentConversation?.id && !streamingConversationId) {
        loadConversation(currentConversation.id);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', reloadMessages);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentConversation?.id, streamingConversationId]);

  // Carica tutti gli agenti all'avvio per useAgentHealth
  useEffect(() => {
    if (session?.user?.id) {
      supabase
        .from('agents')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('active', true)
        .then(({ data, error }) => {
          if (!error && data) {
            setAgents(data);
          }
        });
    }
  }, [session?.user?.id, agentUpdateTrigger]);

  // Auto-select agent from URL parameter when returning from presentation
  useEffect(() => {
    const urlAgentId = searchParams.get('agentId');
    if (urlAgentId && session?.user?.id && !currentAgent) {
      // Load the agent from the URL parameter
      supabase
        .from('agents')
        .select('*')
        .eq('id', urlAgentId)
        .eq('user_id', session.user.id)
        .single()
        .then(({ data: agent, error }) => {
          if (!error && agent) {
            handleSelectAgent(agent);
          }
        });
    }
  }, [searchParams, session?.user?.id, currentAgent]);

  // Check for unsynced documents when agent changes
  useEffect(() => {
    if (currentAgent?.id) {
      checkUnsyncedDocs(currentAgent.id);
    } else {
      setUnsyncedDocsCount(0);
    }
  }, [currentAgent?.id]);

  const checkUnsyncedDocs = async (agentId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('check-and-sync-all', {
        body: { agentId, autoFix: false }
      });

      if (!error && data?.statuses) {
        // Conta sia documenti missing CHE parzialmente sincronizzati
        const problemCount = data.statuses.filter((s: any) => s.status === 'missing' || s.status === 'partial').length;
        setUnsyncedDocsCount(problemCount);
      }
    } catch (error) {
      console.error('Error checking unsynced docs:', error);
    }
  };

  const handleSelectAgent = useCallback(async (agent: Agent) => {
    setCurrentAgent(agent);
    setMessages([]);
    setDrawerOpen(false);
    
    if (!session?.user?.id) return;
    
    // Get or create the unique conversation for this agent
    const { data: conversationId, error } = await supabase.rpc(
      'get_or_create_conversation',
      { 
        p_user_id: session.user.id,
        p_agent_id: agent.id 
      }
    );
    
    if (error) {
      console.error("Error getting conversation:", error);
      return;
    }
    
    if (conversationId) {
      await loadConversation(conversationId);
    }
  }, [session?.user?.id]);

  const handleAgentCreated = useCallback((newAgent: Agent) => {
    // Auto-select the newly created agent
    handleSelectAgent(newAgent);
    console.log(`${newAgent.name} created/updated successfully`);
    setEditingAgent(null);
    // Trigger sidebar refresh
    setAgentUpdateTrigger(prev => prev + 1);
    // Recheck unsynced docs
    if (newAgent?.id) {
      checkUnsyncedDocs(newAgent.id);
    }
  }, [handleSelectAgent]);

  const handleDeleteAgent = async (agentId: string) => {
    try {
      const { error } = await supabase
        .from("agents")
        .delete()
        .eq("id", agentId);

      if (error) throw error;

      console.log("Agent deleted successfully");
      
      // Reset current agent if it was deleted
      if (currentAgent?.id === agentId) {
        setCurrentAgent(null);
        setCurrentConversation(null);
        setMessages([]);
      }
      
      setEditingAgent(null);
    } catch (error: any) {
      console.error("Error deleting agent:", error);
    }
  };

  const loadConversation = async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const { data: conv, error: convError } = await supabase
        .from("agent_conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (convError) throw convError;
      setCurrentConversation(conv);

      const { data: msgs, error: msgsError } = await supabase
        .from("agent_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at");

      if (msgsError) throw msgsError;
      
      // Log LLM providers for debugging
      const llmProviders = msgs.filter(m => m.llm_provider).map(m => ({
        role: m.role,
        provider: m.llm_provider,
        messagePreview: m.content.substring(0, 50)
      }));
      if (llmProviders.length > 0) {
        console.log('💡 LLM Providers in conversation:', llmProviders);
      }
      
      setMessages(msgs.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, llm_provider: m.llm_provider })));
      
      // Force scroll to last message after loading
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 100);
    } catch (error: any) {
      console.error("Error loading conversation:", error);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = async (text: string, attachments?: Array<{ url: string; name: string; type: string }>, forceConversationId?: string, forceAgent?: Agent) => {
    if (!session?.access_token) return;
    
    const agent = forceAgent || currentAgent;
    if (!agent) return;

    const conversationId = forceConversationId || currentConversation?.id;

    if (!conversationId) {
      console.error("No active conversation");
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    
    // Create placeholder for assistant message
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    
    setStreamingConversationId(conversationId);

    try {
      // Create abort controller with 6 minute timeout (slightly longer than edge function)
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        console.error('Request timeout after 6 minutes');
      }, 360000);
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            message: text,
            conversationId,
            agentSlug: agent.slug,
            attachments,
          }),
          keepalive: true,
          signal: controller.signal
        }
      );
      
      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";
      let buffer = "";
      let lastMessageId = "";

      if (!reader) throw new Error("No reader");

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Process any remaining buffer
          if (buffer.trim()) {
            const remainingLines = buffer.split("\n");
            for (const line of remainingLines) {
              if (!line.trim() || line.startsWith(":")) continue;
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "content" && parsed.text) {
                  accumulatedText += parsed.text;
                  setMessages((prev) => 
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, content: accumulatedText } : m
                    )
                  );
                } else if (parsed.type === "message_start") {
                  lastMessageId = parsed.messageId;
                } else if (parsed.type === "complete") {
                  if (parsed.conversationId && !currentConversation) {
                    setCurrentConversation({ id: parsed.conversationId, agent_id: currentAgent.id, title: (text || accumulatedText || "Chat").slice(0, 50) });
                  }
                }
              } catch (e) {
                // Ignore parse errors in final flush
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim() || line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;

          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === "message_start") {
              console.log("📨 Message started:", parsed.messageId);
              lastMessageId = parsed.messageId;
            } else if (parsed.type === "switching_to_background") {
              // Response is switching to background processing
              console.log("⏰ Switching to background processing");
              accumulatedText = parsed.message;
              
              setMessages((prev) => 
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: accumulatedText } : m
                )
              );
              
              // Close EventSource, Realtime will handle updates now
              reader.cancel();
              break;
            } else if (parsed.type === "content" && parsed.text) {
              accumulatedText += parsed.text;
              setMessages((prev) => 
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: accumulatedText } : m
                )
              );
            } else if (parsed.type === "complete") {
              console.log("✅ Streaming complete");
              
              // Log LLM provider info
              if (parsed.llmProvider) {
                console.log('🤖 LLM Provider used:', parsed.llmProvider.toUpperCase());
                // Update message with LLM provider
                setMessages((prev) => 
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, llm_provider: parsed.llmProvider } : m
                  )
                );
              }
              
              if (parsed.conversationId && !currentConversation) {
                setCurrentConversation({ id: parsed.conversationId, agent_id: currentAgent.id, title: (text || accumulatedText || "Chat").slice(0, 50) });
              }
            } else if (parsed.type === "error") {
              const errorMsg = parsed.error || parsed.message || "Unknown error";
              throw new Error(errorMsg);
            }
          } catch (e) {
            console.error("Error parsing SSE:", e);
          }
        }
      }
    } catch (error: any) {
      console.error("Error sending message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id && m.id !== assistantId));
    } finally {
      setStreamingConversationId(null);
    }
  };

  const handleNewChat = () => {
    setCurrentConversation(null);
    setMessages([]);
    setSelectionMode(false);
    setSelectedMessages([]);
  };

  const handleStartSelection = (messageId: string) => {
    setSelectionMode(true);
    setSelectedMessages([messageId]);
  };

  const handleToggleSelection = (messageId: string) => {
    setSelectedMessages(prev => {
      if (prev.includes(messageId)) {
        const newSelection = prev.filter(id => id !== messageId);
        // Exit selection mode if no messages left
        if (newSelection.length === 0) {
          setSelectionMode(false);
        }
        return newSelection;
      } else {
        return [...prev, messageId];
      }
    });
  };

  const handleSelectAll = () => {
    setSelectedMessages(messages.map(m => m.id));
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedMessages([]);
  };

  const handleDeleteMessages = async () => {
    if (selectedMessages.length === 0) return;
    
    try {
      const { error } = await supabase
        .from("agent_messages")
        .delete()
        .in("id", selectedMessages);
      
      if (error) throw error;
      
      setMessages(prev => prev.filter(m => !selectedMessages.includes(m.id)));
      setSelectionMode(false);
      setSelectedMessages([]);
    } catch (error: any) {
      console.error("Error deleting messages:", error);
    }
  };

  const handleForward = () => {
    setShowForwardDialog(true);
  };

  const handleForwardComplete = async (
    conversationId: string, 
    agentId: string, 
    messageContent: string
  ) => {
    setSelectionMode(false);
    setSelectedMessages([]);
    setShowForwardDialog(false);
    
    // Load the agent
    const { data: agentData } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();
    
    if (!agentData) return;
    
    // Set the agent and load the conversation
    setCurrentAgent(agentData);
    await loadConversation(conversationId);
    
    // Small delay to ensure UI has updated
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Send the forwarded message, passing both conversationId and agent explicitly
    await handleSendMessage(messageContent, undefined, conversationId, agentData);
  };

  const handleDeleteAllMessages = async () => {
    if (!currentConversation?.id) return;
    
    try {
      const { error } = await supabase
        .from("agent_messages")
        .delete()
        .eq("conversation_id", currentConversation.id);
      
      if (error) throw error;
      
      setMessages([]);
      setShowDeleteAllDialog(false);
    } catch (error: any) {
      console.error("Error deleting all messages:", error);
    }
  };


  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Desktop Sidebar - Always show AgentsSidebar */}
      {!isMobile && (
        <div className="w-[280px] flex-shrink-0 flex flex-col border-r bg-sidebar">
          <AgentsSidebar
            currentAgentId={currentAgent?.id || null}
            onSelectAgent={handleSelectAgent}
            onCreateAgent={() => setShowCreateModal(true)}
            onEditAgent={(agent) => {
              setEditingAgent(agent);
              setShowCreateModal(true);
            }}
            agentUpdateTrigger={agentUpdateTrigger}
          />
        </div>
      )}


      {/* Mobile Drawer */}
      {isMobile && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-80 p-0">
            <AgentsSidebar
              currentAgentId={currentAgent?.id || null}
              onSelectAgent={handleSelectAgent}
              onCreateAgent={() => {
                setShowCreateModal(true);
                setDrawerOpen(false);
              }}
              onEditAgent={(agent) => {
                setEditingAgent(agent);
                setShowCreateModal(true);
                setDrawerOpen(false);
              }}
              agentUpdateTrigger={agentUpdateTrigger}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* Create Agent Modal */}
      <CreateAgentModal
        open={showCreateModal}
        onOpenChange={(open) => {
          setShowCreateModal(open);
          if (!open) setEditingAgent(null);
        }}
        onSuccess={handleAgentCreated}
        editingAgent={editingAgent}
        onDelete={handleDeleteAgent}
        onDocsUpdated={() => currentAgent?.id && checkUnsyncedDocs(currentAgent.id)}
      />

      {/* Forward Message Dialog */}
            <ForwardMessageDialog
              open={showForwardDialog}
              onOpenChange={setShowForwardDialog}
              message={messages.find(m => m.id === selectedMessages[0]) || null}
              currentAgentId={currentAgent?.id || ""}
              onForwardComplete={handleForwardComplete}
            />


      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-background to-muted/20">
        {currentAgent ? (
          <>
            {/* Global Alerts */}
            <GlobalAlerts hasAgentIssues={agentHealth.hasAnyIssues()} />

            {/* Header with Settings */}
            <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
              <div className="max-w-4xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
                {!selectionMode ? (
                  <>
                     {isMobile && (
                      <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(true)}>
                        <Menu className="h-5 w-5" />
                      </Button>
                     )}
                     <div className="flex items-center gap-3 flex-1 min-w-0 mr-2">
                       <div className="min-w-0 flex-1">
                         <h1 className="font-semibold truncate">{currentAgent.name}</h1>
                       </div>
                        </div>
                         <div className="flex items-center gap-2 flex-shrink-0">
                           {messages.length > 0 && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setAllMessagesExpanded(!allMessagesExpanded)}
                                className="gap-2"
                                title={allMessagesExpanded ? "Riduci tutti" : "Espandi tutti"}
                              >
                                {allMessagesExpanded ? <ChevronsDown className="h-4 w-4" /> : <ChevronsUp className="h-4 w-4" />}
                              </Button>
                            </>
                          )}
                            {currentConversation && (
                              <ExportChatPDF
                                conversationId={currentConversation.id}
                                agentName={currentAgent.name}
                                messages={messages as any}
                              />
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setEditingAgent(currentAgent);
                                    setShowCreateModal(true);
                                  }}
                                  className="relative"
                                >
                                  <Edit className="h-4 w-4" />
                                  {unsyncedDocsCount > 0 && (
                                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                                      {unsyncedDocsCount}
                                    </span>
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {unsyncedDocsCount > 0 
                                  ? `${unsyncedDocsCount} ${unsyncedDocsCount === 1 ? 'documento con problemi di sincronizzazione' : 'documenti con problemi di sincronizzazione'}`
                                  : 'Modifica agente'
                                }
                              </TooltipContent>
                            </Tooltip>
                       </div>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" onClick={handleCancelSelection}>
                      <X className="h-5 w-5" />
                    </Button>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-semibold">
                        {selectedMessages.length} {selectedMessages.length === 1 ? 'messaggio' : 'messaggi'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedMessages.length < messages.length && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleSelectAll}
                          className="gap-2"
                        >
                          <span className="hidden md:inline">Seleziona tutti</span>
                          <span className="md:hidden">Tutti</span>
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        onClick={handleDeleteMessages}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="hidden md:inline">{selectedMessages.length === 1 ? 'Elimina' : 'Elimina tutti'}</span>
                        <span className="md:hidden">Elimina</span>
                      </Button>
                      {selectedMessages.length === 1 && (
                        <Button
                          onClick={handleForward}
                          className="gap-2"
                        >
                          <Forward className="h-4 w-4" />
                          <span className="hidden md:inline">Inoltra</span>
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Messages Container - CENTERED with max-width */}
            <ScrollArea className="flex-1" onScroll={handleScroll}>
              {loadingMessages ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="max-w-4xl mx-auto px-3 md:px-6 py-6">
                  {messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-6 md:p-8 text-center">
                      <div>
                        <div className="text-3xl md:text-4xl mb-3 md:mb-4">{currentAgent.avatar || "🤖"}</div>
                        <h2 className="text-lg md:text-xl font-semibold mb-2">Start a conversation</h2>
                        <p className="text-sm md:text-base text-muted-foreground">
                          Ask {currentAgent.name} anything about {currentAgent.description.toLowerCase()}
                        </p>
                      </div>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <ChatMessage
                        key={msg.id}
                        id={msg.id}
                        role={msg.role}
                        content={msg.content}
                        isStreaming={streamingConversationId === currentConversation?.id && msg.id === messages[messages.length - 1]?.id}
                        selectionMode={selectionMode}
                        isSelected={selectedMessages.includes(msg.id)}
                        onToggleSelection={() => handleToggleSelection(msg.id)}
                        onLongPress={() => handleStartSelection(msg.id)}
                        forceExpanded={allMessagesExpanded}
                        agentId={currentAgent?.id}
                        llmProvider={(msg as any).llm_provider}
                      />
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Chat Input - FIXED BOTTOM with max-width */}
            <div className="border-t bg-background/95 backdrop-blur">
              <div className="max-w-4xl mx-auto px-4 md:px-6 py-4">
                <ChatInput
                  onSend={handleSendMessage}
                  disabled={loadingMessages}
                  sendDisabled={streamingConversationId === currentConversation?.id}
                  placeholder={`Message ${currentAgent.name}...`}
                />
              </div>
            </div>

            {/* Long Response Progress Indicator */}
            {backgroundProgress && activeLongResponse && (
              <div className="fixed bottom-20 right-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 max-w-xs">
                <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">
                    {backgroundProgress.status === 'generating' 
                      ? 'Generating long response...' 
                      : 'Response completed!'}
                  </div>
                  <div className="text-xs opacity-80">
                    {backgroundProgress.totalChars.toLocaleString()} characters
                    {backgroundProgress.status === 'generating' && ' (updating in real-time)'}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-4">
            <div className="text-center">
              {isMobile && (
                <Button variant="outline" size="lg" className="mb-4" onClick={() => setDrawerOpen(true)}>
                  <Menu className="h-5 w-5 mr-2" />
                  Open Menu
                </Button>
              )}
              <h2 className="text-xl md:text-2xl font-semibold mb-2">Select an AI Consultant</h2>
              <p className="text-sm md:text-base text-muted-foreground">
                Choose an expert from the {isMobile ? "menu" : "sidebar"} to start chatting
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Agent Modal */}
      <CreateAgentModal 
        open={showCreateModal} 
        onOpenChange={(open) => {
          setShowCreateModal(open);
          if (!open) setEditingAgent(null);
        }}
        onSuccess={(agent) => {
          if (editingAgent) {
            // Agent updated, refresh current agent if it's the one being edited
            if (currentAgent?.id === agent.id) {
              setCurrentAgent({ ...agent });
            }
          } else {
            // New agent created, select it
            handleSelectAgent({ ...agent });
          }
          setEditingAgent(null);
        }}
        editingAgent={editingAgent ? {
          ...editingAgent,
          system_prompt: editingAgent.system_prompt || ""
        } : null}
        onDelete={handleDeleteAgent}
      />
      
      {/* Forward Message Dialog */}
      <ForwardMessageDialog
        open={showForwardDialog}
        onOpenChange={setShowForwardDialog}
        message={messages.find(m => m.id === selectedMessages[0]) || null}
        currentAgentId={currentAgent?.id || ""}
        onForwardComplete={handleForwardComplete}
      />

      {/* Delete All Messages Confirmation */}
      <AlertDialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancellare tutti i messaggi?</AlertDialogTitle>
            <AlertDialogDescription>
              Questa azione eliminerà tutti i {messages.length} messaggi della chat corrente. 
              Questa operazione non può essere annullata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllMessages}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Elimina tutti
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
