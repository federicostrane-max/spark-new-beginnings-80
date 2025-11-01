import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { ConversationList } from "@/components/ConversationList";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
}

interface Conversation {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
}

interface AgentChatListProps {
  currentAgentId: string | null;
  currentConversationId: string | null;
  onSelectAgent: (agent: Agent, conversationId: string | null) => void;
}

export const AgentChatList = ({ currentAgentId, currentConversationId, onSelectAgent }: AgentChatListProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(currentAgentId);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("active", true)
        .order("name");

      if (error) throw error;
      setAgents(data || []);
    } catch (error) {
      console.error("Error loading agents:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-sidebar">
        <Loader2 className="h-6 w-6 animate-spin text-sidebar-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      <div className="border-b border-sidebar-border p-4">
        <h2 className="text-lg font-semibold text-sidebar-primary">AI Consultants</h2>
        <p className="text-sm text-sidebar-foreground">Select an expert to chat with</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {agents.map((agent) => {
            const isExpanded = expandedAgentId === agent.id;
            const isActive = currentAgentId === agent.id;
            
            return (
              <div key={agent.id} className="space-y-1">
                <button
                  onClick={() => {
                    setExpandedAgentId(isExpanded ? null : agent.id);
                    if (!isActive) {
                      onSelectAgent(agent, null);
                    }
                  }}
                  className={cn(
                    "w-full rounded-lg p-3 text-left transition-colors",
                    "hover:bg-sidebar-accent",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 mt-1 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 mt-1 flex-shrink-0" />
                    )}
                    <div className="text-2xl flex-shrink-0">{agent.avatar || "🤖"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{agent.name}</div>
                      <div className="text-xs opacity-80 line-clamp-2">{agent.description}</div>
                    </div>
                  </div>
                </button>
                
                {isExpanded && (
                  <ConversationList
                    agentId={agent.id}
                    currentConversationId={currentConversationId}
                    onSelectConversation={(conv: Conversation) => onSelectAgent(agent, conv.id)}
                    onNewConversation={() => onSelectAgent(agent, null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
