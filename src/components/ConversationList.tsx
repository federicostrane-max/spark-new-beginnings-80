import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Conversation {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
}

interface ConversationListProps {
  agentId: string;
  currentConversationId: string | null;
  onSelectConversation: (conversation: Conversation) => void;
  onNewConversation: () => void;
}

export const ConversationList = ({
  agentId,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
}: ConversationListProps) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadConversations();
  }, [agentId]);

  const loadConversations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("agent_conversations")
        .select("*")
        .eq("agent_id", agentId)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setConversations(data || []);
    } catch (error) {
      console.error("Error loading conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { error } = await supabase
        .from("agent_conversations")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setConversations(conversations.filter((c) => c.id !== id));
      toast({ title: "Conversation deleted" });

      if (currentConversationId === id) {
        onNewConversation();
      }
    } catch (error) {
      console.error("Error deleting conversation:", error);
      toast({ title: "Error", description: "Failed to delete conversation", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-4 w-4 animate-spin text-sidebar-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <Button
        onClick={onNewConversation}
        className="w-full justify-start gap-2"
        variant="outline"
        size="sm"
      >
        <MessageSquarePlus className="h-4 w-4" />
        New Chat
      </Button>

      {conversations.length > 0 && (
        <ScrollArea className="h-[200px]">
          <div className="space-y-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv)}
                className={cn(
                  "group flex items-center justify-between rounded-md p-2 text-sm cursor-pointer transition-colors",
                  "hover:bg-sidebar-accent",
                  currentConversationId === conv.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground"
                )}
              >
                <span className="flex-1 truncate">{conv.title}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                  onClick={(e) => deleteConversation(conv.id, e)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
