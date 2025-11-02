import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Plus, LogOut, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  agent_id: string;
}

interface ChatSidebarProps {
  currentConversationId: string | null;
  currentAgentId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onNewChat: () => void;
}

export const ChatSidebar = ({ 
  currentConversationId, 
  currentAgentId,
  onSelectConversation, 
  onNewChat 
}: ChatSidebarProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentAgentId) {
      loadConversations();
    }
  }, [currentAgentId]);

  const loadConversations = async () => {
    if (!currentAgentId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_conversations")
        .select("*")
        .eq("agent_id", currentAgentId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setConversations(data || []);
    } catch (error: any) {
      console.error("Error loading conversations:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      const { error } = await supabase
        .from("agent_conversations")
        .delete()
        .eq("id", conversationId);

      if (error) throw error;
      
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      
      if (conversationId === currentConversationId) {
        onNewChat();
      }
    } catch (error: any) {
      console.error("Error deleting conversation:", error);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* User Profile */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={user?.user_metadata?.avatar_url} />
            <AvatarFallback className="bg-primary text-primary-foreground">
              {user?.email?.[0].toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{user?.user_metadata?.name || "User"}</p>
            <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <Button 
          onClick={onNewChat} 
          className="w-full justify-start gap-2"
          variant="default"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Conversations List */}
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-4">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">No conversations yet</div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={cn(
                  "w-full text-left p-3 rounded-lg transition-colors group relative",
                  conv.id === currentConversationId
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                <p className="font-medium truncate pr-8">{conv.title}</p>
                <p className={cn(
                  "text-xs",
                  conv.id === currentConversationId ? "opacity-90" : "opacity-70"
                )}>
                  {formatDistanceToNow(new Date(conv.created_at), { addSuffix: true })}
                </p>
                
                {/* Delete button (hover) */}
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "absolute right-2 top-2 opacity-0 group-hover:opacity-100 h-6 w-6 transition-opacity",
                    conv.id === currentConversationId && "hover:bg-primary-foreground/20"
                  )}
                  onClick={(e) => handleDeleteConversation(conv.id, e)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Logout Button */}
      <div className="p-3 border-t">
        <Button 
          variant="ghost" 
          className="w-full justify-start gap-2"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  );
};
