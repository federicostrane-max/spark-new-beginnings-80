import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, X, AtSign, Zap, MessageSquare, Edit, Eye, Globe, GitBranch, FileCode, FolderOpen, GitPullRequest, Brain, ListChecks, Play } from "lucide-react";
import { VoiceInput } from "./VoiceInput";
import { AttachmentUpload } from "./AttachmentUpload";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
}

interface ChatInputProps {
  onSend: (message: string, attachments?: Array<{ url: string; name: string; type: string }>, forcedTool?: string) => void;
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
  const [pendingForcedTool, setPendingForcedTool] = useState<string | null>(null);
  const [luxConfig, setLuxConfig] = useState<Array<{ lux_mode: string; agent_id: string | null; agents: { slug: string; name: string } | null }>>([]);
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

  // Fetch Lux mode configuration
  useEffect(() => {
    const fetchLuxConfig = async () => {
      const { data, error } = await supabase
        .from('lux_mode_config')
        .select('lux_mode, agent_id, agents(slug, name)');
      
      if (!error && data) {
        setLuxConfig(data as any);
      }
    };
    
    fetchLuxConfig();
  }, []);

  // Detect @agent mentions in input (validate against active agents)
  useEffect(() => {
    const agentMentionRegex = /@([a-zA-Z0-9\-_]+)/g;
    const potentialSlugs: string[] = [];
    let match;
    
    while ((match = agentMentionRegex.exec(input)) !== null) {
      potentialSlugs.push(match[1]);
    }
    
    // Filter ONLY slugs that match active agents (whitelist validation)
    const validSlugs = new Set(availableAgents.map(a => a.slug));
    const validMentions = potentialSlugs.filter(slug => validSlugs.has(slug));
    
    setMentionedAgents(validMentions);
  }, [input, availableAgents]);

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
      onSend(input.trim(), attachments.length > 0 ? attachments : undefined, pendingForcedTool || undefined);
      setInput("");
      setAttachments([]);
      setPendingForcedTool(null); // Reset after sending
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

  const insertAgentAction = (action: string) => {
    let template = '';
    let forcedTool: string | null = null;
    
    switch(action) {
      case 'consult':
        template = '@';
        break;
      case 'modify':
        template = 'modifica prompt @';
        break;
      case 'delegate':
        // Sintassi: @agente1 [azione] @agente2
        // Es: "@supervisore modifica prompt @esperto"
        template = '@ [scrivi l\'azione] @';
        break;
      case 'show-prompt':
        template = 'mostra prompt @';
        break;
      case 'show-knowledge':
        template = 'mostra knowledge @';
        break;
      case 'search-knowledge':
        template = 'cerca knowledge @';
        break;
      case 'lux-actor':
        template = 'Azione semplice: ';
        forcedTool = 'create_actor_task';
        break;
      case 'lux-thinker':
        template = 'Task complesso: ';
        forcedTool = 'create_thinker_task';
        break;
      case 'lux-tasker':
        template = 'Automazione con step: ';
        forcedTool = 'create_tasker_task';
        break;
      case 'github-read':
        template = 'Leggi file da GitHub: owner/repo path/to/file.js';
        forcedTool = 'github_read_file';
        break;
      case 'github-write':
        template = 'Scrivi file su GitHub: owner/repo path/to/file.js [descrivi modifiche]';
        forcedTool = 'github_write_file';
        break;
      case 'github-list':
        template = 'Elenca file repository GitHub: owner/repo';
        forcedTool = 'github_list_files';
        break;
      case 'github-branch':
        template = 'Crea branch GitHub: owner/repo nome-branch';
        forcedTool = 'github_create_branch';
        break;
      case 'github-pr':
        template = 'Crea Pull Request GitHub: owner/repo head-branch -> base-branch [titolo e descrizione]';
        forcedTool = 'github_create_pr';
        break;
    }
    
    // Set forced tool if applicable
    setPendingForcedTool(forcedTool);
    
    // Insert template at cursor position
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const textBefore = input.slice(0, cursorPos);
    const textAfter = input.slice(cursorPos);
    
    const newInput = textBefore + template + textAfter;
    setInput(newInput);
    
    // Move cursor after template
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = cursorPos + template.length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  return (
    <div className="space-y-2">
      {/* Forced Tool Badge */}
      {pendingForcedTool && (
        <div className="flex gap-2 items-center p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
          {pendingForcedTool?.startsWith('github_') ? <GitBranch className="h-4 w-4 text-emerald-500" /> : 
           pendingForcedTool?.startsWith('create_') && pendingForcedTool?.includes('_task') ? <Play className="h-4 w-4 text-emerald-500" /> :
           <Globe className="h-4 w-4 text-emerald-500" />}
          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
            🤖 Tool forzato: {
              pendingForcedTool === 'create_actor_task' ? 'Lux Actor' :
              pendingForcedTool === 'create_thinker_task' ? 'Lux Thinker' :
              pendingForcedTool === 'create_tasker_task' ? 'Lux Tasker' :
              pendingForcedTool === 'github_read_file' ? 'GitHub Read' :
              pendingForcedTool === 'github_write_file' ? 'GitHub Write' :
              pendingForcedTool === 'github_list_files' ? 'GitHub List' :
              pendingForcedTool === 'github_create_branch' ? 'GitHub Branch' :
              pendingForcedTool === 'github_create_pr' ? 'GitHub PR' :
              pendingForcedTool
            }
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 ml-auto"
            onClick={() => setPendingForcedTool(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

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
          
          <div className="flex items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="Azioni Agente" className="h-8 w-8">
                  <Zap className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => insertAgentAction('consult')}>
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Consulta Agente
                </DropdownMenuItem>
                
                <DropdownMenuItem onClick={() => insertAgentAction('modify')}>
                  <Edit className="mr-2 h-4 w-4" />
                  Modifica Prompt Agente
                </DropdownMenuItem>
                
                <DropdownMenuItem onClick={() => insertAgentAction('delegate')}>
                  <Zap className="mr-2 h-4 w-4" />
                  Delega Azione ad Altro Agente
                </DropdownMenuItem>
                
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Play className="mr-2 h-4 w-4" />
                    Lux Automation
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => insertAgentAction('lux-actor')}>
                      <Zap className="mr-2 h-4 w-4" />
                      Actor (Semplice)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertAgentAction('lux-thinker')}>
                      <Brain className="mr-2 h-4 w-4" />
                      Thinker (Complesso)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertAgentAction('lux-tasker')}>
                      <ListChecks className="mr-2 h-4 w-4" />
                      Tasker (Con Step)
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <GitBranch className="mr-2 h-4 w-4" />
                    GitHub Tools
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => insertAgentAction('github-read')}>
                      <FileCode className="mr-2 h-4 w-4" />
                      Leggi File
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertAgentAction('github-write')}>
                      <Edit className="mr-2 h-4 w-4" />
                      Scrivi/Modifica File
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertAgentAction('github-list')}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Elenca File Repository
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertAgentAction('github-branch')}>
                      <GitBranch className="mr-2 h-4 w-4" />
                      Crea Branch
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertAgentAction('github-pr')}>
                      <GitPullRequest className="mr-2 h-4 w-4" />
                      Crea Pull Request
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Eye className="mr-2 h-4 w-4" />
                    Visualizza Info Agente
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => insertAgentAction('show-prompt')}>
                      Mostra Prompt
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertAgentAction('show-knowledge')}>
                      Mostra Knowledge Base
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => insertAgentAction('search-knowledge')}>
                      Cerca nel Knowledge
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          
            <AttachmentUpload onAttachmentAdded={handleAttachment} disabled={disabled} />
            
            <Button
              type="button"
              onClick={() => handleSubmit()}
              disabled={disabled || sendDisabled || (!input.trim() && attachments.length === 0)}
              size="icon"
              className="flex-shrink-0 h-8 w-8"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
