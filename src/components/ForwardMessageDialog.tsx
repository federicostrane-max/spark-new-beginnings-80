import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

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
  agent?: Agent;
}

interface ForwardMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: { id: string; role: "user" | "assistant"; content: string } | null;
  currentAgentId: string;
  onForwardComplete: (conversationId: string, agentId: string) => void;
}

export const ForwardMessageDialog = ({
  open,
  onOpenChange,
  message,
  currentAgentId,
  onForwardComplete,
}: ForwardMessageDialogProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (open) {
      loadData();
      setSelectedAgent(null);
    }
  }, [open]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load all agents
      const { data: agentsData, error: agentsError } = await supabase
        .from("agents")
        .select("*")
        .eq("active", true)
        .order("name");

      if (agentsError) throw agentsError;
      setAgents(agentsData || []);
    } catch (error) {
      console.error("Error loading agents:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectAgent = (agentId: string) => {
    setSelectedAgent(agentId);
  };

  const handleForward = async () => {
    if (!selectedAgent || !message) return;
    
    setForwarding(true);
    
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("No session");

      // Get or create conversation with the selected agent
      const { data: conversationId, error: rpcError } = await supabase.rpc(
        'get_or_create_conversation',
        { 
          p_user_id: session.session.user.id,
          p_agent_id: selectedAgent 
        }
      );

      if (rpcError) throw rpcError;
      if (!conversationId) throw new Error('No conversation ID returned');

      // Insert the forwarded message as a user message
      const { error: insertError } = await supabase
        .from("agent_messages")
        .insert({
          conversation_id: conversationId,
          role: 'user',
          content: message.content
        });

      if (insertError) throw insertError;

      // Update conversation timestamp
      await supabase
        .from("agent_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      if (!isMobile) {
        toast({
          title: "Messaggio inoltrato",
          description: "L'agente sta elaborando la risposta...",
        });
      }

      onOpenChange(false);
      onForwardComplete(conversationId, selectedAgent);
      
    } catch (error: any) {
      console.error("Error forwarding message:", error);
      if (!isMobile) {
        toast({
          title: "Errore",
          description: "Errore durante l'inoltro del messaggio",
          variant: "destructive",
        });
      }
    } finally {
      setForwarding(false);
    }
  };

  const filteredAgents = agents.filter(
    (agent) =>
      agent.id !== currentAgentId &&
      (agent.name.toLowerCase().includes(search.toLowerCase()) ||
        agent.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] bg-background flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Inoltra messaggio</DialogTitle>
          <DialogDescription>
            Seleziona l'agente destinatario
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col space-y-4 overflow-hidden min-h-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cerca conversazioni o agenti..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 flex-1">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="flex-1 overflow-auto">
              <div className="space-y-4 pr-4">
                {/* All Agents */}
                {filteredAgents.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold mb-3 px-2 text-foreground">Seleziona agenti</h3>
                    <div className="space-y-2">
                      {filteredAgents.map((agent) => (
                        <div
                          key={agent.id}
                          onClick={() => selectAgent(agent.id)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors",
                            "hover:bg-accent border-2",
                            selectedAgent === agent.id ? "border-primary bg-accent" : "border-transparent"
                          )}
                        >
                          <div className="text-2xl flex-shrink-0">
                            {agent.avatar || "🤖"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {agent.name}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {agent.description}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Nessun agente trovato
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          <div className="flex gap-2 flex-shrink-0 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={forwarding}
            >
              Annulla
            </Button>
            <Button
              onClick={handleForward}
              className="flex-1"
              disabled={!selectedAgent || forwarding}
            >
              {forwarding ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Inoltro...
                </>
              ) : (
                "Inoltra"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
