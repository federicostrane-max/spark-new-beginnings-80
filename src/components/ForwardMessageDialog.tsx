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
  messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  currentAgentId: string;
  onForwardComplete: () => void;
}

export const ForwardMessageDialog = ({
  open,
  onOpenChange,
  messages,
  currentAgentId,
  onForwardComplete,
}: ForwardMessageDialogProps) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [forwarding, setForwarding] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      loadData();
      setSelectedAgents(new Set());
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
      toast({ 
        title: "Errore", 
        description: "Impossibile caricare gli agenti", 
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    const newSet = new Set(selectedAgents);
    if (newSet.has(agentId)) {
      newSet.delete(agentId);
    } else {
      newSet.add(agentId);
    }
    setSelectedAgents(newSet);
  };

  const handleForward = async () => {
    if (selectedAgents.size === 0) {
      toast({ 
        title: "Attenzione", 
        description: "Seleziona almeno un agente", 
        variant: "destructive" 
      });
      return;
    }

    try {
      setForwarding(true);

      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("No session");

      // Inoltra a tutti gli agenti selezionati (ottieni o crea la conversazione unica)
      for (const agentId of selectedAgents) {
        console.log('[ForwardMessage] Getting/creating conversation for:', {
          userId: session.session.user.id,
          agentId
        });

        // Ottieni o crea la conversazione unica per questo agente
        const { data: conversationId, error: rpcError } = await supabase.rpc(
          'get_or_create_conversation',
          { 
            p_user_id: session.session.user.id,
            p_agent_id: agentId 
          }
        );

        console.log('[ForwardMessage] RPC result:', { conversationId, rpcError });

        if (rpcError) {
          console.error('[ForwardMessage] RPC error details:', rpcError);
          throw rpcError;
        }

        if (!conversationId) {
          throw new Error('No conversation ID returned from RPC');
        }

        // Inserisci i messaggi inoltrati
        const messagesToInsert = messages.map((msg) => ({
          conversation_id: conversationId,
          role: msg.role,
          content: msg.content,
        }));

        const { error: insertError } = await supabase
          .from("agent_messages")
          .insert(messagesToInsert);

        if (insertError) throw insertError;

        // Aggiorna timestamp conversazione
        await supabase
          .from("agent_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);
      }

      toast({ 
        title: "Successo", 
        description: `${messages.length} messaggio${messages.length > 1 ? "i" : ""} inoltrat${messages.length > 1 ? "i" : "o"} a ${selectedAgents.size} agente${selectedAgents.size > 1 ? "i" : ""}` 
      });
      
      onForwardComplete();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error forwarding messages:", error);
      toast({ 
        title: "Errore", 
        description: error.message || "Impossibile inoltrare i messaggi", 
        variant: "destructive" 
      });
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
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] bg-background overflow-hidden">
        <DialogHeader>
          <DialogTitle>Inoltra {messages.length} messaggio{messages.length > 1 ? "i" : ""}</DialogTitle>
          <DialogDescription>
            Seleziona una o più destinazioni
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="max-h-[50vh] min-h-[200px]">
              <div className="space-y-4 pr-4">
                {/* All Agents */}
                {filteredAgents.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold mb-3 px-2 text-foreground">Seleziona agenti</h3>
                    <div className="space-y-2">
                      {filteredAgents.map((agent) => (
                        <div
                          key={agent.id}
                          onClick={() => toggleAgent(agent.id)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors",
                            "hover:bg-accent",
                            selectedAgents.has(agent.id) && "bg-accent"
                          )}
                        >
                          <Checkbox
                            checked={selectedAgents.has(agent.id)}
                            onCheckedChange={() => toggleAgent(agent.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
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

          <div className="flex gap-2">
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
              disabled={selectedAgents.size === 0 || forwarding}
            >
              {forwarding ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Inoltro...
                </>
              ) : (
                `Inoltra a ${selectedAgents.size} agente${selectedAgents.size === 1 ? "" : "i"}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
