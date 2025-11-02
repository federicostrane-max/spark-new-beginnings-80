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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedConversations, setSelectedConversations] = useState<Set<string>>(new Set());
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [forwarding, setForwarding] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      loadData();
      setSelectedConversations(new Set());
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

      // Load recent conversations
      const { data: convsData, error: convsError } = await supabase
        .from("agent_conversations")
        .select(`
          *,
          agents (
            id,
            name,
            slug,
            description,
            avatar
          )
        `)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (convsError) throw convsError;
      
      const formattedConvs = (convsData || []).map((conv: any) => ({
        id: conv.id,
        agent_id: conv.agent_id,
        title: conv.title,
        agent: conv.agents,
      }));
      
      setConversations(formattedConvs);
    } catch (error) {
      console.error("Error loading data:", error);
      toast({ 
        title: "Errore", 
        description: "Impossibile caricare le conversazioni", 
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleConversation = (convId: string) => {
    const newSet = new Set(selectedConversations);
    if (newSet.has(convId)) {
      newSet.delete(convId);
    } else {
      newSet.add(convId);
    }
    setSelectedConversations(newSet);
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
    const totalSelected = selectedConversations.size + selectedAgents.size;
    
    if (totalSelected === 0) {
      toast({ 
        title: "Attenzione", 
        description: "Seleziona almeno una destinazione", 
        variant: "destructive" 
      });
      return;
    }

    try {
      setForwarding(true);

      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("No session");

      // Inoltra a tutte le conversazioni selezionate
      for (const convId of selectedConversations) {
        const messagesToInsert = messages.map((msg) => ({
          conversation_id: convId,
          role: msg.role,
          content: msg.content,
        }));

        const { error: insertError } = await supabase
          .from("agent_messages")
          .insert(messagesToInsert);

        if (insertError) throw insertError;
      }

      // Inoltra a tutti gli agenti selezionati (crea nuove conversazioni)
      for (const agentId of selectedAgents) {
        const firstMessageContent = messages[0].content;
        const title = `Forwarded: ${firstMessageContent.slice(0, 40)}...`;

        const { data: newConv, error: convError } = await supabase
          .from("agent_conversations")
          .insert({
            agent_id: agentId,
            user_id: session.session.user.id,
            title,
          })
          .select()
          .single();

        if (convError) throw convError;

        const messagesToInsert = messages.map((msg) => ({
          conversation_id: newConv.id,
          role: msg.role,
          content: msg.content,
        }));

        const { error: insertError } = await supabase
          .from("agent_messages")
          .insert(messagesToInsert);

        if (insertError) throw insertError;
      }

      toast({ 
        title: "Successo", 
        description: `${messages.length} messaggio${messages.length > 1 ? "i" : ""} inoltrat${messages.length > 1 ? "i" : "o"} a ${totalSelected} destinazione${totalSelected > 1 ? "i" : ""}` 
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

  const filteredConversations = conversations.filter(
    (conv) =>
      conv.agent_id !== currentAgentId &&
      (conv.title.toLowerCase().includes(search.toLowerCase()) ||
        conv.agent?.name.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredAgents = agents.filter(
    (agent) =>
      agent.id !== currentAgentId &&
      agent.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
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
            <ScrollArea className="h-[400px]">
              <div className="space-y-4">
                {/* Recent Conversations */}
                {filteredConversations.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 px-2">Conversazioni recenti</h3>
                    <div className="space-y-1">
                      {filteredConversations.map((conv) => (
                        <div
                          key={conv.id}
                          onClick={() => toggleConversation(conv.id)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors",
                            "hover:bg-accent",
                            selectedConversations.has(conv.id) && "bg-accent"
                          )}
                        >
                          <Checkbox
                            checked={selectedConversations.has(conv.id)}
                            onCheckedChange={() => toggleConversation(conv.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="text-2xl flex-shrink-0">
                            {conv.agent?.avatar || "🤖"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {conv.title}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {conv.agent?.name}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* All Agents */}
                {filteredAgents.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 px-2">
                      {filteredConversations.length > 0 ? "Altri agenti" : "Agenti"}
                    </h3>
                    <div className="space-y-1">
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
                              Nuova conversazione
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {filteredConversations.length === 0 && filteredAgents.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    Nessun risultato
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
              disabled={(selectedConversations.size === 0 && selectedAgents.size === 0) || forwarding}
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
