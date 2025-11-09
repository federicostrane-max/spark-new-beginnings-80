import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, LogOut, BookOpen, Trash2, Edit, Database, Settings, AlertCircle, RefreshCw, Search } from "lucide-react";
import { useAgentHealth, usePoolDocumentsHealth } from "@/hooks/useAgentHealth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  system_prompt: string;
}

interface AgentsSidebarProps {
  currentAgentId: string | null;
  onSelectAgent: (agent: Agent) => void;
  onCreateAgent: () => void;
  onEditAgent: (agent: Agent) => void;
  agentUpdateTrigger?: number;
}

export const AgentsSidebar = ({ 
  currentAgentId, 
  onSelectAgent,
  onCreateAgent,
  onEditAgent,
  agentUpdateTrigger
}: AgentsSidebarProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgentForKB, setSelectedAgentForKB] = useState<Agent | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [stuckDocumentsCount, setStuckDocumentsCount] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [syncingAgents, setSyncingAgents] = useState<Set<string>>(new Set());
  
  // Health monitoring
  const agentIds = agents.map(a => a.id);
  const { healthStatus, getAgentStatus } = useAgentHealth(agentIds);
  const poolHealth = usePoolDocumentsHealth();

  useEffect(() => {
    loadAgents();
  }, []);

  // Reload agents when agentUpdateTrigger changes
  useEffect(() => {
    if (agentUpdateTrigger !== undefined && agentUpdateTrigger > 0) {
      console.log('[AgentsSidebar] agentUpdateTrigger changed:', agentUpdateTrigger);
      // Add small delay to ensure DB write is complete
      setTimeout(() => {
        loadAgents();
      }, 200);
    }
  }, [agentUpdateTrigger]);

  // Realtime subscription for agents table
  useEffect(() => {
    console.log('[AgentsSidebar] Setting up realtime subscription');
    
    const channel = supabase
      .channel('agents-sidebar-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agents'
          // NO FILTER - we need to capture DELETE events too
        },
        (payload) => {
          console.log('[AgentsSidebar] Realtime agent change:', payload.eventType, payload);
          // Reload agents on any change (INSERT, UPDATE, DELETE)
          loadAgents();
        }
      )
      .subscribe((status) => {
        console.log('[AgentsSidebar] Subscription status:', status);
      });

    return () => {
      console.log('[AgentsSidebar] Cleaning up subscription');
      supabase.removeChannel(channel);
    };
  }, []);

  const loadAgents = async () => {
    console.log('[AgentsSidebar] Loading agents...');
    // Add a small delay before showing loading state to prevent flashing
    const loadingTimeout = setTimeout(() => setLoading(true), 300);
    
    try {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      console.log('[AgentsSidebar] Loaded', data?.length || 0, 'agents');
      setAgents(data || []);
    } catch (error: any) {
      console.error("[AgentsSidebar] Error loading agents:", error);
    } finally {
      clearTimeout(loadingTimeout);
      setLoading(false);
    }
  };

  // Check for stuck documents on mount
  useEffect(() => {
    const checkStuckDocuments = async () => {
      const { data, error } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .eq('validation_status', 'validated')
        .eq('processing_status', 'downloaded');

      if (!error && data !== null) {
        setStuckDocumentsCount(data.length || 0);
      }
    };

    checkStuckDocuments();
    // Refresh every 30 seconds
    const interval = setInterval(checkStuckDocuments, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  const handleDeleteAgent = async () => {
    if (!agentToDelete) return;
    
    try {
      const { error } = await supabase
        .from("agents")
        .delete()
        .eq("id", agentToDelete.id);

      if (error) throw error;

      setAgentToDelete(null);
      loadAgents();
    } catch (error: any) {
      console.error("Error deleting agent:", error);
    }
  };

  const handleSyncAgent = async (agentId: string) => {
    setSyncingAgents(prev => new Set(prev).add(agentId));
    
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        throw new Error('Sessione non valida');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-and-sync-all`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.data.session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ agentId, autoFix: true })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const syncedCount = data?.statuses?.filter((s: any) => s.status === 'missing').length || 0;

      if (syncedCount > 0) {
        toast.success(`${syncedCount} ${syncedCount === 1 ? 'documento sincronizzato' : 'documenti sincronizzati'}`);
        setTimeout(() => window.location.reload(), 1000);
      } else {
        toast.info("Tutti i documenti sono già sincronizzati");
      }
    } catch (error: any) {
      console.error("Error syncing agent:", error);
      toast.error(`Errore: ${error.message}`);
    } finally {
      setSyncingAgents(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
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

      {/* Search Box */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-sidebar-foreground/50" />
          <Input
            placeholder="Cerca agente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/50"
          />
        </div>
      </div>

      {/* Agents List */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-1 p-2">
          {loading ? (
            <div className="text-sm text-sidebar-foreground/70 text-center py-4">Loading...</div>
          ) : agents.filter(agent => 
              agent.name.toLowerCase().includes(searchQuery.toLowerCase())
            ).length === 0 ? (
            <div className="text-sm text-sidebar-foreground/70 text-center py-4">
              {searchQuery ? "Nessun agente trovato" : "No agents yet"}
            </div>
          ) : (
            agents
              .filter(agent => agent.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((agent) => {
              const agentHealth = getAgentStatus(agent.id);
              const showHealthBadge = agentHealth?.hasIssues;
              
              return (
                <TooltipProvider key={agent.id}>
                  <div
                    className={cn(
                      "group flex items-center gap-2 w-full rounded-lg p-3 transition-colors text-left relative cursor-pointer",
                      agent.id === currentAgentId
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                    )}
                    onClick={() => onSelectAgent(agent)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium line-clamp-2 break-words">{agent.name}</p>
                      <p className="text-xs opacity-70 line-clamp-2">{agent.description}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {showHealthBadge && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                                {agentHealth.unsyncedCount}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <p className="text-xs">
                                {agentHealth.unsyncedCount} {agentHealth.unsyncedCount === 1 ? 'documento non sincronizzato' : 'documenti non sincronizzati'}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSyncAgent(agent.id);
                            }}
                            disabled={syncingAgents.has(agent.id)}
                          >
                            <RefreshCw className={`h-3 w-3 ${syncingAgents.has(agent.id) ? 'animate-spin' : ''}`} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </TooltipProvider>
              );
            })
          )}
        </div>
        </ScrollArea>
      </div>

      {/* Footer Buttons */}
      <div className="p-3 border-t border-sidebar-border space-y-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={() => navigate("/documents")}
              >
                <Database className="h-4 w-4" />
                <span className="flex-1 text-left">Pool Documenti</span>
                {poolHealth.hasIssues && poolHealth.issueCount > 0 && (
                  <Badge variant="destructive" className="ml-auto">
                    {poolHealth.issueCount}
                  </Badge>
                )}
              </Button>
            </TooltipTrigger>
            {poolHealth.hasIssues && (
              <TooltipContent side="right" className="max-w-xs">
                <div className="space-y-2">
                  <p className="font-semibold text-destructive">⚠️ Problemi nel Pool Documenti</p>
                  <div className="text-sm space-y-1">
                    {poolHealth.stuckCount > 0 && (
                      <p>• <strong>{poolHealth.stuckCount}</strong> {poolHealth.stuckCount === 1 ? 'documento bloccato' : 'documenti bloccati'} in validazione</p>
                    )}
                    {poolHealth.errorCount > 0 && (
                      <p>• <strong>{poolHealth.errorCount}</strong> {poolHealth.errorCount === 1 ? 'documento con errore' : 'documenti con errori'} di elaborazione</p>
                    )}
                    {poolHealth.validatingCount > 0 && (
                      <p>• <strong>{poolHealth.validatingCount}</strong> {poolHealth.validatingCount === 1 ? 'documento bloccato' : 'documenti bloccati'} in validazione da oltre 1 ora</p>
                    )}
                  </div>
                  <p className="text-xs opacity-80 mt-2 border-t pt-2">
                    Questi documenti non possono essere utilizzati dagli agenti fino a quando i problemi non vengono risolti.
                  </p>
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={() => navigate("/admin")}
        >
          <Settings className="h-4 w-4" />
          <span className="flex-1 text-left">Admin Panel</span>
          {stuckDocumentsCount > 0 && (
            <Badge variant="destructive" className="ml-auto">
              {stuckDocumentsCount}
            </Badge>
          )}
        </Button>
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
        <DialogContent 
          className="max-w-4xl max-h-[90vh]" 
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
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