import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTTS } from "@/contexts/TTSContext";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { AgentsSidebar } from "@/components/AgentsSidebar";

import { CreateAgentModal } from "@/components/CreateAgentModal";
import { ForwardMessageDialog } from "@/components/ForwardMessageDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Menu, Forward, X, Edit, ChevronsDown, ChevronsUp, Trash2, Database } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
  const [allMessagesExpanded, setAllMessagesExpanded] = useState<boolean | undefined>(undefined);
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();

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
    if (isUserAtBottom && !isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isUserAtBottom, isStreaming]);

  // Pre-generate audio for assistant messages when streaming stops
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant' && lastMessage.content.trim()) {
        // Pre-generate audio in background
        preGenerateAudio(lastMessage.id, lastMessage.content);
      }
    }
  }, [isStreaming, messages, preGenerateAudio]);

  // Reload messages when returning to the app
  useEffect(() => {
    const reloadMessages = () => {
      if (currentConversation?.id && !isStreaming) {
        loadConversation(currentConversation.id);
      }
    };

    // Reload when window regains focus (user returns to app)
    window.addEventListener('focus', reloadMessages);
    
    // Also reload on visibility change (mobile)
    const handleVisibilityChange = () => {
      if (!document.hidden && currentConversation?.id && !isStreaming) {
        loadConversation(currentConversation.id);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', reloadMessages);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentConversation?.id, isStreaming]);

  const handleSelectAgent = async (agent: Agent) => {
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
  };

  const handleAgentCreated = (newAgent: Agent) => {
    // Auto-select the newly created agent
    handleSelectAgent(newAgent);
    console.log(`${newAgent.name} ${editingAgent ? 'updated' : 'created'} successfully`);
    setEditingAgent(null);
  };

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
    
    setIsStreaming(true);

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
            Authorization: `Bearer ${session.access_token}`,
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
      setIsStreaming(false);
    }
  };

  const handleNewChat = () => {
    setCurrentConversation(null);
    setMessages([]);
    setSelectionMode(false);
    setSelectedMessage(null);
  };

  const handleStartSelection = (messageId: string) => {
    setSelectionMode(true);
    setSelectedMessage(messageId);
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedMessage(null);
  };

  const handleDeleteMessages = async () => {
    if (!selectedMessage) return;
    
    try {
      const { error } = await supabase
        .from("agent_messages")
        .delete()
        .eq("id", selectedMessage);
      
      if (error) throw error;
      
      setMessages(prev => prev.filter(m => m.id !== selectedMessage));
      setSelectionMode(false);
      setSelectedMessage(null);
    } catch (error: any) {
      console.error("Error deleting message:", error);
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
    setSelectedMessage(null);
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
      />

      {/* Forward Message Dialog */}
            <ForwardMessageDialog
              open={showForwardDialog}
              onOpenChange={setShowForwardDialog}
              message={messages.find(m => m.id === selectedMessage) || null}
              currentAgentId={currentAgent?.id || ""}
              onForwardComplete={handleForwardComplete}
            />


      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-background to-muted/20">
        {currentAgent ? (
          <>
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
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate("/documents")}
                            title="Pool Documenti"
                          >
                            <Database className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditingAgent(currentAgent);
                              setShowCreateModal(true);
                            }}
                            title="Modifica agente"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
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
                             <Button
                               variant="ghost"
                               size="sm"
                               onClick={() => setShowDeleteAllDialog(true)}
                               className="gap-2 text-destructive hover:text-destructive"
                               title="Cancella tutti i messaggi"
                             >
                               <Trash2 className="h-4 w-4" />
                             </Button>
                           </>
                         )}
                      </div>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" onClick={handleCancelSelection}>
                      <X className="h-5 w-5" />
                    </Button>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-semibold">
                        Messaggio selezionato
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="destructive"
                        onClick={handleDeleteMessages}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="hidden md:inline">Elimina</span>
                      </Button>
                      <Button
                        onClick={handleForward}
                        className="gap-2"
                      >
                        <Forward className="h-4 w-4" />
                        <span className="hidden md:inline">Inoltra</span>
                      </Button>
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
                        isStreaming={isStreaming && msg.id === messages[messages.length - 1]?.id}
                        selectionMode={selectionMode}
                        isSelected={selectedMessage === msg.id}
                        onToggleSelection={() => {}}
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
                  disabled={isStreaming || loadingMessages}
                  placeholder={`Message ${currentAgent.name}...`}
                />
              </div>
            </div>
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
        message={messages.find(m => m.id === selectedMessage) || null}
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
