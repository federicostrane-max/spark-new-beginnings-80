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
      console.warn("Seleziona almeno un agente");
      return;
    }

    try {
      setForwarding(true);

      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("No session");

      // Inoltra a tutti gli agenti selezionati
      for (const agentId of selectedAgents) {
        const agent = agents.find(a => a.id === agentId);
        if (!agent) continue;

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

        // IMPORTANTE: Genera automaticamente la risposta dell'agente ricevente
        // Prendi l'ultimo messaggio inoltrato come prompt per l'agente
        const lastMessage = messages[messages.length - 1];
        
        // Crea un messaggio placeholder per la risposta
        const assistantPlaceholderId = crypto.randomUUID();
        await supabase
          .from("agent_messages")
          .insert({
            id: assistantPlaceholderId,
            conversation_id: conversationId,
            role: "assistant",
            content: "",
          });

        // Chiama l'edge function per ottenere la risposta
        try {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.session.access_token}`,
              },
              body: JSON.stringify({
                message: lastMessage.content,
                conversationId,
                agentSlug: agent.slug,
              }),
            }
          );

          if (!response.ok) {
            console.error("Error getting agent response:", await response.text());
            // Rimuovi il placeholder se c'è un errore
            await supabase
              .from("agent_messages")
              .delete()
              .eq("id", assistantPlaceholderId);
          } else {
            // Stream la risposta (la gestiamo in background)
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = "";

            if (reader) {
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
                    if (parsed.type === "content" && parsed.text) {
                      accumulatedText += parsed.text;
                      // Aggiorna il messaggio nel database
                      await supabase
                        .from("agent_messages")
                        .update({ content: accumulatedText })
                        .eq("id", assistantPlaceholderId);
                    }
                  } catch (e) {
                    console.error("Error parsing SSE:", e);
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error("Error calling agent-chat:", error);
          // Rimuovi il placeholder se c'è un errore
          await supabase
            .from("agent_messages")
            .delete()
            .eq("id", assistantPlaceholderId);
        }
      }

      console.log(`${messages.length} messaggio${messages.length > 1 ? "i" : ""} inoltrat${messages.length > 1 ? "i" : "o"} a ${selectedAgents.size} agente${selectedAgents.size > 1 ? "i" : ""}`);
      
      toast({
        title: "Messaggi inoltrati",
        description: `${messages.length} messaggio${messages.length > 1 ? "i" : ""} inoltrat${messages.length > 1 ? "i" : "o"} con successo. Gli agenti stanno rispondendo...`,
      });
      
      onForwardComplete();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error forwarding messages:", error);
      toast({
        title: "Errore",
        description: "Si è verificato un errore durante l'inoltro dei messaggi",
        variant: "destructive",
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
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] bg-background flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Inoltra {messages.length} messaggio{messages.length > 1 ? "i" : ""}</DialogTitle>
          <DialogDescription>
            Seleziona una o più destinazioni
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
