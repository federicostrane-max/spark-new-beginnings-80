import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { UserMenu } from "@/components/UserMenu";
import { AgentChatList } from "@/components/AgentChatList";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
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
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectAgent = async (agent: Agent, conversationId: string | null) => {
    setCurrentAgent(agent);
    setMessages([]);
    
    if (conversationId) {
      await loadConversation(conversationId);
    } else {
      setCurrentConversation(null);
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

  const createConversation = async (firstMessage: string): Promise<string> => {
    if (!currentAgent || !session?.user) throw new Error("No agent or user");

    const title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? "..." : "");

    const { data, error } = await supabase
      .from("agent_conversations")
      .insert({
        agent_id: currentAgent.id,
        user_id: session.user.id,
        title,
      })
      .select()
      .single();

    if (error) throw error;
    setCurrentConversation(data);
    return data.id;
  };

  const handleSendMessage = async (text: string) => {
    if (!currentAgent || !session?.access_token) return;

    let conversationId = currentConversation?.id;

    if (!conversationId) {
      try {
        conversationId = await createConversation(text);
      } catch (error: any) {
        console.error("Error creating conversation:", error);
        toast({ title: "Error", description: "Failed to create conversation", variant: "destructive" });
        return;
      }
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);

    try {
      const messageHistory = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ];

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            messages: messageHistory,
            conversationId,
            agentSlug: currentAgent.slug,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";
      let assistantId = crypto.randomUUID();

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

            if (parsed.type === "token" && parsed.content) {
              assistantMessage += parsed.content;
              setMessages((prev) => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.role === "assistant" && lastMsg.id === assistantId) {
                  return prev.map((m) =>
                    m.id === assistantId ? { ...m, content: assistantMessage } : m
                  );
                }
                return [...prev, { id: assistantId, role: "assistant", content: assistantMessage }];
              });
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
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex h-screen w-full">
      <div className="w-80 flex-shrink-0 flex flex-col">
        <UserMenu />
        <AgentChatList
          currentAgentId={currentAgent?.id || null}
          currentConversationId={currentConversation?.id || null}
          onSelectAgent={handleSelectAgent}
        />
      </div>

      <div className="flex flex-1 flex-col">
        {currentAgent ? (
          <>
            <div className="border-b border-border bg-background p-4">
              <div className="flex items-center gap-3">
                <div className="text-3xl">{currentAgent.avatar || "🤖"}</div>
                <div>
                  <h1 className="text-xl font-semibold">{currentAgent.name}</h1>
                  <p className="text-sm text-muted-foreground">{currentAgent.description}</p>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1">
              {loadingMessages ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="pb-4">
                  {messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-8 text-center">
                      <div>
                        <div className="text-4xl mb-4">{currentAgent.avatar || "🤖"}</div>
                        <h2 className="text-xl font-semibold mb-2">Start a conversation</h2>
                        <p className="text-muted-foreground">
                          Ask {currentAgent.name} anything about {currentAgent.description.toLowerCase()}
                        </p>
                      </div>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <ChatMessage
                        key={msg.id}
                        role={msg.role}
                        content={msg.content}
                        isStreaming={isStreaming && msg.id === messages[messages.length - 1]?.id}
                      />
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            <ChatInput
              onSend={handleSendMessage}
              disabled={isStreaming || loadingMessages}
              placeholder={`Ask ${currentAgent.name}...`}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <h2 className="text-2xl font-semibold mb-2">Select an AI Consultant</h2>
              <p className="text-muted-foreground">Choose an expert from the sidebar to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
