import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { AgentsSidebar } from "@/components/AgentsSidebar";

import { CreateAgentModal } from "@/components/CreateAgentModal";
import { ForwardMessageDialog } from "@/components/ForwardMessageDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Menu, Forward, X, Edit } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

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
}

interface Conversation {
  id: string;
  agent_id: string;
  title: string;
}

export default function MultiAgentConsultant() {
  const { session } = useAuth();
  const isMobile = useIsMobile();
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
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

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
      toast({ 
        title: "Error", 
        description: "Failed to load conversation", 
        variant: "destructive" 
      });
      return;
    }
    
    if (conversationId) {
      await loadConversation(conversationId);
    }
  };

  const handleAgentCreated = (newAgent: Agent) => {
    // Auto-select the newly created agent
    handleSelectAgent(newAgent);
    toast({ title: "Success", description: `${newAgent.name} ${editingAgent ? 'updated' : 'created'} successfully!` });
    setEditingAgent(null);
  };

  const handleDeleteAgent = async (agentId: string) => {
    try {
      const { error } = await supabase
        .from("agents")
        .delete()
        .eq("id", agentId);

      if (error) throw error;

      toast({ title: "Success", description: "Agent deleted successfully!" });
      
      // Reset current agent if it was deleted
      if (currentAgent?.id === agentId) {
        setCurrentAgent(null);
        setCurrentConversation(null);
        setMessages([]);
      }
      
      setEditingAgent(null);
    } catch (error: any) {
      console.error("Error deleting agent:", error);
      toast({ title: "Error", description: "Failed to delete agent", variant: "destructive" });
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
      setMessages(msgs.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })));
    } catch (error: any) {
      console.error("Error loading conversation:", error);
      toast({ title: "Error", description: "Failed to load conversation", variant: "destructive" });
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = async (text: string, attachments?: Array<{ url: string; name: string; type: string }>) => {
    if (!currentAgent || !session?.access_token) return;

    const conversationId = currentConversation?.id;

    if (!conversationId) {
      toast({ title: "Error", description: "No active conversation", variant: "destructive" });
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
            agentSlug: currentAgent.slug,
            attachments,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";

      if (!reader) throw new Error("No reader");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.trim() || line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;

          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === "message_start") {
              // Backend created placeholder, we already have one in UI
              console.log("Message started:", parsed.messageId);
            } else if (parsed.type === "content" && parsed.text) {
              accumulatedText += parsed.text;
              setMessages((prev) => 
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: accumulatedText } : m
                )
              );
            } else if (parsed.type === "complete") {
              // Stream complete
              if (parsed.conversationId && !currentConversation) {
                setCurrentConversation({ id: parsed.conversationId, agent_id: currentAgent.id, title: text.slice(0, 50) });
              }
            } else if (parsed.type === "error") {
              throw new Error(parsed.error);
            }
          } catch (e) {
            console.error("Error parsing SSE:", e);
          }
        }
      }
    } catch (error: any) {
      console.error("Error sending message:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id && m.id !== assistantId));
    } finally {
      setIsStreaming(false);
    }
  };

  const handleNewChat = () => {
    setCurrentConversation(null);
    setMessages([]);
    setSelectionMode(false);
    setSelectedMessages(new Set());
  };

  const toggleMessageSelection = (messageId: string) => {
    const newSelection = new Set(selectedMessages);
    if (newSelection.has(messageId)) {
      newSelection.delete(messageId);
    } else {
      newSelection.add(messageId);
    }
    setSelectedMessages(newSelection);
  };

  const handleStartSelection = () => {
    setSelectionMode(true);
    setSelectedMessages(new Set());
  };

  const handleCancelSelection = () => {
    setSelectionMode(false);
    setSelectedMessages(new Set());
  };

  const handleForward = () => {
    if (selectedMessages.size === 0) {
      toast({ 
        title: "Attenzione", 
        description: "Seleziona almeno un messaggio", 
        variant: "destructive" 
      });
      return;
    }
    setShowForwardDialog(true);
  };

  const handleForwardComplete = () => {
    setSelectionMode(false);
    setSelectedMessages(new Set());
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
        messages={messages.filter(m => selectedMessages.has(m.id))}
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
                       <div className="text-3xl flex-shrink-0">{currentAgent.avatar || "🤖"}</div>
                       <div className="min-w-0 flex-1">
                         <h1 className="font-semibold truncate">{currentConversation?.title || "New Chat"}</h1>
                         <p className="text-sm text-muted-foreground truncate">{currentAgent.name}</p>
                       </div>
                     </div>
                     <div className="flex items-center gap-2 flex-shrink-0">
                       <Button
                         variant="outline"
                         size="sm"
                         onClick={() => {
                           setEditingAgent(currentAgent);
                           setShowCreateModal(true);
                         }}
                         className="gap-2"
                       >
                         <Edit className="h-4 w-4" />
                         <span className="hidden md:inline">Modifica</span>
                       </Button>
                       {messages.length > 0 && (
                         <Button
                           variant="ghost"
                           size="sm"
                           onClick={handleStartSelection}
                           className="gap-2"
                         >
                           <Forward className="h-4 w-4" />
                           <span className="hidden md:inline">Inoltra</span>
                         </Button>
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
                        {selectedMessages.size} selezionat{selectedMessages.size === 1 ? "o" : "i"}
                      </span>
                    </div>
                    <Button
                      onClick={handleForward}
                      disabled={selectedMessages.size === 0}
                      className="gap-2"
                    >
                      <Forward className="h-4 w-4" />
                      Inoltra
                    </Button>
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
                <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
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
                        isSelected={selectedMessages.has(msg.id)}
                        onToggleSelection={() => toggleMessageSelection(msg.id)}
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
        messages={Array.from(selectedMessages)
          .map(id => messages.find(m => m.id === id))
          .filter((m): m is Message => m !== undefined)}
        currentAgentId={currentAgent?.id || ""}
        onForwardComplete={handleForwardComplete}
      />
    </div>
  );
}
