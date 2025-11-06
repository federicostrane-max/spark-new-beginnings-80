import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, X, AtSign } from "lucide-react";
import { VoiceInput } from "./VoiceInput";
import { AttachmentUpload } from "./AttachmentUpload";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
}

interface ChatInputProps {
  onSend: (message: string, attachments?: Array<{ url: string; name: string; type: string }>) => void;
  disabled?: boolean;
  sendDisabled?: boolean;
  placeholder?: string;
}

export const ChatInput = ({ onSend, disabled, sendDisabled, placeholder = "Type your message..." }: ChatInputProps) => {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Array<{ url: string; name: string; type: string }>>([]);
  const [mentionedAgents, setMentionedAgents] = useState<string[]>([]);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [showAgentSuggestions, setShowAgentSuggestions] = useState(false);
  const [agentSuggestions, setAgentSuggestions] = useState<Agent[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Fetch available agents on mount
  useEffect(() => {
    const fetchAgents = async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('id, name, slug, description')
        .eq('active', true)
        .order('name', { ascending: true });
      
      if (!error && data) {
        setAvailableAgents(data);
      }
    };
    
    fetchAgents();
  }, []);

  // Detect @agent mentions in input
  useEffect(() => {
    const agentMentionRegex = /@([a-zA-Z0-9\-_]+)/g;
    const matches = [];
    let match;
    
    while ((match = agentMentionRegex.exec(input)) !== null) {
      matches.push(match[1]);
    }
    
    setMentionedAgents(matches);
  }, [input]);

  // Detect @ trigger and show suggestions
  useEffect(() => {
    const cursorPos = textareaRef.current?.selectionStart || 0;
    const textBeforeCursor = input.slice(0, cursorPos);
    
    // Find the last @ before cursor
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      // Get text after @ up to cursor
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      
      // Check if there's no space (we're still in the mention)
      if (!textAfterAt.includes(' ') && textAfterAt.length >= 0) {
        setMentionStartPos(lastAtIndex);
        
        // Filter agents by the text after @
        const filtered = availableAgents.filter(agent => 
          agent.name.toLowerCase().includes(textAfterAt.toLowerCase()) ||
          agent.slug.toLowerCase().includes(textAfterAt.toLowerCase())
        );
        
        setAgentSuggestions(filtered);
        setShowAgentSuggestions(filtered.length > 0);
        setSelectedSuggestionIndex(0);
      } else {
        setShowAgentSuggestions(false);
        setMentionStartPos(null);
      }
    } else {
      setShowAgentSuggestions(false);
      setMentionStartPos(null);
    }
  }, [input, availableAgents]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (input.trim() && !disabled) {
      // Close suggestions when submitting
      setShowAgentSuggestions(false);
      onSend(input.trim(), attachments.length > 0 ? attachments : undefined);
      setInput("");
      setAttachments([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle agent suggestions navigation
    if (showAgentSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => 
          prev < agentSuggestions.length - 1 ? prev + 1 : prev
        );
        return;
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : 0);
        return;
      }
      
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectAgent(agentSuggestions[selectedSuggestionIndex]);
        return;
      }
      
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAgentSuggestions(false);
        return;
      }
    }
    
    // Normal Enter to send
    if (e.key === "Enter" && !e.shiftKey && !showAgentSuggestions) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const selectAgent = (agent: Agent) => {
    if (mentionStartPos === null) return;
    
    const cursorPos = textareaRef.current?.selectionStart || 0;
    const textBefore = input.slice(0, mentionStartPos);
    const textAfter = input.slice(cursorPos);
    
    // Insert agent slug after @
    const newInput = `${textBefore}@${agent.slug} ${textAfter}`;
    setInput(newInput);
    
    // Close suggestions
    setShowAgentSuggestions(false);
    setMentionStartPos(null);
    
    // Focus back on textarea
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = mentionStartPos + agent.slug.length + 2; // +2 for @ and space
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleTranscription = (text: string) => {
    setInput(prev => prev + (prev ? ' ' : '') + text);
  };

  const handleAttachment = (url: string, name: string, type: string) => {
    setAttachments(prev => [...prev, { url, name, type }]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        
        const file = item.getAsFile();
        if (!file) continue;

        // Validate file type
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          toast({
            title: "Formato non supportato",
            description: "Solo immagini JPEG, PNG e WebP sono supportate.",
            variant: "destructive"
          });
          continue;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
          toast({
            title: "File troppo grande",
            description: "Le immagini devono essere inferiori a 10MB.",
            variant: "destructive"
          });
          continue;
        }

        try {
          const fileExt = file.type.split('/')[1];
          const fileName = `${Date.now()}.${fileExt}`;
          const filePath = `${fileName}`;

          const { error: uploadError, data } = await supabase.storage
            .from('agent-attachments')
            .upload(filePath, file);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('agent-attachments')
            .getPublicUrl(filePath);

          handleAttachment(publicUrl, fileName, file.type);
          
          toast({
            title: "Immagine incollata",
            description: "L'immagine è stata aggiunta agli allegati."
          });
        } catch (error) {
          console.error('Error uploading pasted image:', error);
          toast({
            title: "Errore",
            description: "Impossibile caricare l'immagine incollata.",
            variant: "destructive"
          });
        }
      }
    }
  };

  return (
    <div className="space-y-2">
      {/* Agent Mentions Preview */}
      {mentionedAgents.length > 0 && (
        <div className="flex gap-2 items-center p-2 bg-primary/10 rounded-lg border border-primary/20">
          <AtSign className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted-foreground">Consulting agents:</span>
          {mentionedAgents.map((agentName, idx) => (
            <Badge key={idx} variant="secondary" className="bg-primary/20 text-primary">
              @{agentName}
            </Badge>
          ))}
        </div>
      )}
      
      {/* Attachments Preview */}
      {attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap p-2 bg-muted/50 rounded-lg">
          {attachments.map((att, idx) => (
            <div key={idx} className="relative group">
              {att.type.startsWith('image/') ? (
                <img 
                  src={att.url} 
                  alt={att.name}
                  className="h-16 w-16 object-cover rounded"
                />
              ) : (
                <div className="h-16 w-16 flex items-center justify-center bg-muted rounded text-xs">
                  {att.name}
                </div>
              )}
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeAttachment(idx)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Input Container */}
      <div className="relative">
        {/* Agent Suggestions Dropdown */}
        {showAgentSuggestions && agentSuggestions.length > 0 && (
          <div 
            ref={suggestionsRef}
            className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-background border rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto"
          >
            {agentSuggestions.map((agent, index) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => selectAgent(agent)}
                className={`w-full text-left px-4 py-3 hover:bg-accent transition-colors ${
                  index === selectedSuggestionIndex ? 'bg-accent' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <AtSign className="h-4 w-4 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{agent.name}</div>
                    <div className="text-xs text-muted-foreground truncate">@{agent.slug}</div>
                    {agent.description && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {agent.description}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        
        <div className="flex items-end gap-2 p-3 border rounded-2xl bg-background shadow-lg">
          <VoiceInput onTranscription={handleTranscription} disabled={disabled} />
          
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled}
            className="min-h-[44px] max-h-[200px] resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent"
            rows={1}
          />
          
          <div className="flex items-center gap-1">
            <div className="text-xs text-muted-foreground px-1" title="Tag agents with @agent-name to request their help">
              <AtSign className="h-4 w-4" />
            </div>
          
          <AttachmentUpload onAttachmentAdded={handleAttachment} disabled={disabled} />
          
          <Button
            type="button"
            onClick={() => handleSubmit()}
            disabled={disabled || sendDisabled || (!input.trim() && attachments.length === 0)}
            size="icon"
            className="flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
