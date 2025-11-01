import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
}

interface AgentChatListProps {
  currentAgentId: string | null;
  onSelectAgent: (agent: Agent) => void;
}

export const AgentChatList = ({ currentAgentId, onSelectAgent }: AgentChatListProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

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
        <div className="space-y-1 p-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent)}
              className={cn(
                "w-full rounded-lg p-3 text-left transition-colors",
                "hover:bg-sidebar-accent",
                currentAgentId === agent.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl">{agent.avatar || "🤖"}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{agent.name}</div>
                  <div className="text-xs opacity-80 line-clamp-2">{agent.description}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
