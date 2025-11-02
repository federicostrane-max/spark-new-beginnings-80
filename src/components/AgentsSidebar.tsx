import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Plus, LogOut, MoreVertical, BookOpen, Trash2, Edit } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KnowledgeBaseManager } from "@/components/KnowledgeBaseManager";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
}

interface AgentsSidebarProps {
  currentAgentId: string | null;
  onSelectAgent: (agent: Agent) => void;
  onCreateAgent: () => void;
  onEditAgent: (agent: Agent) => void;
}

export const AgentsSidebar = ({ 
  currentAgentId, 
  onSelectAgent,
  onCreateAgent,
  onEditAgent
}: AgentsSidebarProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgentForKB, setSelectedAgentForKB] = useState<Agent | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);

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

  const handleDeleteAgent = async () => {
    if (!agentToDelete) return;
    
    try {
      const { error } = await supabase
        .from("agents")
        .update({ active: false })
        .eq("id", agentToDelete.id);

      if (error) throw error;

      toast({ title: "Success", description: `${agentToDelete.name} deleted successfully` });
      setAgentToDelete(null);
      loadAgents();
    } catch (error: any) {
      console.error("Error deleting agent:", error);
      toast({ title: "Error", description: "Failed to delete agent", variant: "destructive" });
    }
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
              <div
                key={agent.id}
                className={cn(
                  "flex items-center gap-2 w-full rounded-lg p-3 transition-colors",
                  agent.id === currentAgentId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                )}
              >
                {/* Agent Info - clickable */}
                <button
                  onClick={() => onSelectAgent(agent)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="text-2xl flex-shrink-0">{agent.avatar || "🤖"}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{agent.name}</p>
                    <p className="text-xs opacity-70 truncate">{agent.description}</p>
                  </div>
                </button>

                {/* Three dots menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0 border border-gray-400 bg-white hover:bg-gray-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4 text-gray-700" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-50 bg-popover">
                    <DropdownMenuItem onClick={() => onEditAgent(agent)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit Agent
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedAgentForKB(agent)}>
                      <BookOpen className="mr-2 h-4 w-4" />
                      Manage Knowledge Base
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => setAgentToDelete(agent)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Agent
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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

      {/* Knowledge Base Manager Dialog */}
      <Dialog open={!!selectedAgentForKB} onOpenChange={(open) => !open && setSelectedAgentForKB(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Knowledge Base - {selectedAgentForKB?.name}</DialogTitle>
          </DialogHeader>
          {selectedAgentForKB && (
            <KnowledgeBaseManager 
              agentId={selectedAgentForKB.id} 
              agentName={selectedAgentForKB.name} 
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!agentToDelete} onOpenChange={(open) => !open && setAgentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete "{agentToDelete?.name}". All conversations and knowledge base data will be preserved but the agent will be deactivated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAgent} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};