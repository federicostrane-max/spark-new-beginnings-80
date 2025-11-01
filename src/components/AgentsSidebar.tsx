import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Plus, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  avatar: string | null;
}

interface AgentsSidebarProps {
  currentAgentId: string | null;
  onSelectAgent: (agent: Agent) => void;
  onCreateAgent: () => void;
}

export const AgentsSidebar = ({ 
  currentAgentId, 
  onSelectAgent,
  onCreateAgent
}: AgentsSidebarProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAgents(data || []);
    } catch (error: any) {
      console.error("Error loading agents:", error);
      toast({ title: "Error", description: "Failed to load agents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* User Profile */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={user?.user_metadata?.avatar_url} />
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground">
              {user?.email?.[0].toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sidebar-foreground">{user?.user_metadata?.name || "User"}</p>
            <p className="text-sm text-sidebar-foreground/70 truncate">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Create Agent Button */}
      <div className="p-3">
        <Button 
          onClick={onCreateAgent} 
          className="w-full justify-start gap-2"
          variant="default"
        >
          <Plus className="h-4 w-4" />
          Create New Agent
        </Button>
      </div>

      {/* Agents List */}
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {loading ? (
            <div className="text-sm text-sidebar-foreground/70 text-center py-4">Loading...</div>
          ) : agents.length === 0 ? (
            <div className="text-sm text-sidebar-foreground/70 text-center py-4">No agents yet</div>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent)}
                className={cn(
                  "w-full text-left p-3 rounded-lg transition-colors",
                  agent.id === currentAgentId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="text-2xl flex-shrink-0">{agent.avatar || "🤖"}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{agent.name}</p>
                    <p className="text-xs opacity-70 truncate">{agent.description}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Logout Button */}
      <div className="p-3 border-t border-sidebar-border">
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  );
};