import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Play, Square, ChevronDown, ChevronUp, Presentation, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTTS } from "@/contexts/TTSContext";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessageProps {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
  isSelected?: boolean;
  selectionMode?: boolean;
  onToggleSelection?: () => void;
  onLongPress?: () => void;
  forceExpanded?: boolean;
  agentId?: string;
  llmProvider?: string;
}

export const ChatMessage = ({ 
  id, 
  role, 
  content, 
  isStreaming, 
  isSelected = false,
  selectionMode = false,
  onToggleSelection,
  onLongPress,
  forceExpanded,
  agentId,
  llmProvider
}: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  // null = segui forceExpanded, true/false = override manuale
  const [isManuallyExpanded, setIsManuallyExpanded] = useState<boolean | null>(null);
  const [justReceivedLongContent, setJustReceivedLongContent] = useState(false);
  const [reloadingContent, setReloadingContent] = useState(false);
  const prevContentLengthRef = useRef(content.length);
  const { currentMessageId, status, playMessage, stop } = useTTS();
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const justEnteredSelectionMode = useRef(false);
  const navigate = useNavigate();

  // Get LLM provider badge info
  const getLLMBadge = () => {
    if (!llmProvider || role === 'user') return null;
    
    const badges = {
      anthropic: { label: 'Claude', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
      deepseek: { label: 'DeepSeek', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
      openai: { label: 'GPT', color: 'bg-green-500/10 text-green-600 border-green-500/20' },
    };
    
    return badges[llmProvider as keyof typeof badges] || null;
  };

  const llmBadge = getLLMBadge();

  // Reset override manuale quando forceExpanded cambia (comando globale)
  useEffect(() => {
    setIsManuallyExpanded(null);
  }, [forceExpanded]);

  // Reset justEnteredSelectionMode when exiting selection mode
  useEffect(() => {
    if (!selectionMode) {
      justEnteredSelectionMode.current = false;
    }
  }, [selectionMode]);

  // FIX 3: Espansione al primo render di messaggi lunghi già completati
  useEffect(() => {
    const COLLAPSE_THRESHOLD = 1000;
    if (!isStreaming && content.length > COLLAPSE_THRESHOLD && isManuallyExpanded === null) {
      console.log(`📖 [Message ${id.slice(0,8)}] Long message detected at mount (${content.length} chars) - auto-expanding`);
      setIsManuallyExpanded(true);
    }
  }, []); // Empty deps = solo al mount

  // FIX 1: Espansione quando finisce lo streaming con contenuto lungo
  useEffect(() => {
    const COLLAPSE_THRESHOLD = 1000;
    // Quando finisce lo streaming E il messaggio è lungo → forza espansione
    if (!isStreaming && content.length > COLLAPSE_THRESHOLD && prevContentLengthRef.current < content.length) {
      console.log(`✅ [Message ${id.slice(0,8)}] Streaming completed with ${content.length} chars - auto-expanding`);
      setIsManuallyExpanded(true);
      setJustReceivedLongContent(true);
      
      setTimeout(() => {
        setJustReceivedLongContent(false);
      }, 2000);
    }
    
    prevContentLengthRef.current = content.length;
  }, [isStreaming, content.length, id]);

  // FIX 2: Auto-expand quando il contenuto cresce significativamente (soglia ridotta a 2000)
  useEffect(() => {
    const prevLength = prevContentLengthRef.current;
    const currentLength = content.length;
    const COLLAPSE_THRESHOLD = 1000;
    
    // SOGLIA RIDOTTA: da 5000 a 2000 caratteri
    if (currentLength > prevLength + 2000 && currentLength > COLLAPSE_THRESHOLD) {
      console.log(`🔄 [Message ${id.slice(0,8)}] Content grew from ${prevLength} to ${currentLength} - forcing expand`);
      setJustReceivedLongContent(true);
      setIsManuallyExpanded(true);
      
      setTimeout(() => {
        setJustReceivedLongContent(false);
      }, 2000);
    }
    
    prevContentLengthRef.current = currentLength;
  }, [content.length, id]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReloadFullMessage = async () => {
    if (!agentId) return;
    setReloadingContent(true);
    
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: dbMessage } = await supabase
        .from('agent_messages')
        .select('content')
        .eq('id', id)
        .single();
      
      if (dbMessage && dbMessage.content !== content) {
        console.log(`🔄 [RELOAD] Reloaded full message (${dbMessage.content.length} chars)`);
        // This will trigger parent component to update
        window.location.reload();
      }
    } catch (error) {
      console.error('[RELOAD] Error reloading message:', error);
    } finally {
      setReloadingContent(false);
    }
  };

  const handleTTS = () => {
    if (status === 'loading' && currentMessageId === id) {
      // During loading: prevent clicks
      return;
    }
    
    if (currentMessageId === id && status === 'playing') {
      // During playback: STOP completely (not pause)
      stop();
    } else {
      // Otherwise: play
      playMessage(id, content);
    }
  };

  const handleMessageClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (selectionMode && onToggleSelection) {
      e.preventDefault();
      e.stopPropagation();
      
      // Ignore first click/touch after entering selection mode
      if (justEnteredSelectionMode.current) {
        justEnteredSelectionMode.current = false;
        return;
      }
      
      onToggleSelection();
    }
  };

  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const mouseStartY = useRef(0);
  const mouseStartX = useRef(0);
  const hasMoved = useRef(false);
  const hasTextSelection = useRef(false);

  const handleLongPressStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (selectionMode) return;
    
    // Check if there's already a text selection - if so, don't interfere
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      hasTextSelection.current = true;
      return;
    }
    
    hasTextSelection.current = false;
    
    // Track initial position to detect scrolling/dragging/text selection
    if ('touches' in e) {
      touchStartY.current = e.touches[0].clientY;
      touchStartX.current = e.touches[0].clientX;
      hasMoved.current = false;
    } else if ('clientY' in e) {
      mouseStartY.current = e.clientY;
      mouseStartX.current = e.clientX;
      hasMoved.current = false;
    }
    
    setIsLongPressing(true);
    longPressTimer.current = setTimeout(() => {
      // Only trigger long press if user hasn't moved AND no text is selected
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().length > 0;
      
      if (!hasMoved.current && !hasSelection && onLongPress) {
        onLongPress();
        justEnteredSelectionMode.current = true;
        // Vibrazione per feedback tattile (se disponibile)
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
      setIsLongPressing(false);
    }, 800); // Ridotto a 800ms per essere più responsive
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Detect if user is scrolling or selecting text
    if (touchStartY.current || touchStartX.current) {
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current);
      const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current);
      // Ridotta soglia per permettere selezione testo più facilmente
      if (deltaY > 10 || deltaX > 10) {
        hasMoved.current = true;
        handleLongPressEnd();
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // Detect if user is dragging or selecting text
    if (mouseStartY.current || mouseStartX.current) {
      const deltaY = Math.abs(e.clientY - mouseStartY.current);
      const deltaX = Math.abs(e.clientX - mouseStartX.current);
      // Ridotta soglia per permettere selezione testo più facilmente
      if (deltaY > 10 || deltaX > 10) {
        hasMoved.current = true;
        handleLongPressEnd();
      }
    }
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    setIsLongPressing(false);
    touchStartY.current = 0;
    touchStartX.current = 0;
    mouseStartY.current = 0;
    mouseStartX.current = 0;
    hasMoved.current = false;
    hasTextSelection.current = false;
  };

  const isUser = role === "user";
  const isSystem = role === "system";
  const isTTSPlaying = currentMessageId === id && status === 'playing';
  
  // 🔍 Diagnostica: Log cambiamenti di isStreaming
  useEffect(() => {
    if (!isUser) {
      console.log(`🎬 [Message ${id.slice(0,8)}] isStreaming changed to: ${isStreaming}, content: ${content.length} chars`);
    }
  }, [isStreaming, id, isUser, content.length]);
  
  const COLLAPSE_THRESHOLD = 1000;
  const isExpanded = isManuallyExpanded ?? (justReceivedLongContent ? true : forceExpanded) ?? true;
  
  const shouldCollapse = !isExpanded && content.length > COLLAPSE_THRESHOLD;
  const displayContent = shouldCollapse 
    ? content.slice(0, COLLAPSE_THRESHOLD) + "..."
    : content;
  
  // Detect potentially truncated messages (stopped mid-sentence)
  const isPotentiallyTruncated = !isStreaming && 
    content.length > 10000 && 
    !content.endsWith('.') && 
    !content.endsWith('!') && 
    !content.endsWith('?') &&
    !content.endsWith('"') &&
    !content.endsWith("'");
  
  // Diagnostic logging per messaggi lunghi
  useEffect(() => {
    if (!isUser && content.length > 1000) {
      console.log(`📏 [Message ${id.slice(0,8)}] Render state:`, {
        contentLength: content.length,
        isExpanded,
        forceExpanded,
        isManuallyExpanded,
        isStreaming,
        displayLength: displayContent.length,
        justReceivedLongContent
      });
    }
  }, [content.length, isExpanded, forceExpanded, isManuallyExpanded, isStreaming, id, isUser, displayContent.length, justReceivedLongContent]);
  

  // System messages have special rendering
  if (isSystem) {
    return (
      <div className="mb-4 flex justify-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/50 text-sm text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="mb-4 group relative touch-pan-y"
      onClick={selectionMode ? handleMessageClick : undefined}
      onTouchEnd={selectionMode ? handleMessageClick : handleLongPressEnd}
      onTouchStart={!selectionMode ? handleLongPressStart : undefined}
      onTouchMove={!selectionMode ? handleTouchMove : undefined}
      onTouchCancel={handleLongPressEnd}
      onMouseDown={!selectionMode ? handleLongPressStart : undefined}
      onMouseMove={!selectionMode ? handleMouseMove : undefined}
      onMouseUp={handleLongPressEnd}
      onMouseLeave={handleLongPressEnd}
    >
      {selectionMode && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 z-10">
          <div
            className={cn(
              "h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all",
              isSelected
                ? "bg-primary border-primary"
                : "bg-background border-muted-foreground/30"
            )}
          >
            {isSelected && <Check className="h-4 w-4 text-primary-foreground" />}
          </div>
        </div>
      )}
      <div
        className={cn(
          "inline-block rounded-2xl px-4 py-3 shadow-sm transition-all",
          "w-fit max-w-[calc(100vw-2rem)] md:max-w-[75%]",
          "select-text cursor-text",
          isUser && !selectionMode && "ml-auto",
          selectionMode && "ml-8",
          isUser 
            ? "bg-primary text-primary-foreground" 
            : "bg-muted text-foreground",
          isSelected && "ring-2 ring-primary",
          isLongPressing && !hasMoved.current && "scale-95 opacity-80",
          isStreaming && !isUser && "ring-2 ring-primary/30 animate-pulse"
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words overflow-wrap-anywhere select-text">
            {displayContent}
          </div>
        ) : (
          <div className="break-words overflow-wrap-anywhere select-text [&_*]:break-words [&_p]:my-2 [&_p]:leading-7 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:my-2 [&_strong]:font-bold [&_em]:italic [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2 [&_li]:my-1 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:rounded [&_pre]:overflow-visible [&_pre]:max-h-none [&_pre]:whitespace-pre-wrap [&_pre]:my-2 [&_pre_code]:whitespace-pre-wrap [&_pre_code]:break-words [&_table]:w-full [&_table]:my-4 [&_table]:border-collapse [&_table]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_thead]:bg-muted/50 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-sm [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_td]:align-top [&_tr]:border-b [&_tr]:border-border">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node, ...props }) => (
                  <a
                    {...props}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80 transition-colors cursor-pointer break-all"
                    onClick={(e) => e.stopPropagation()}
                  />
                ),
              }}
            >
              {displayContent}
            </ReactMarkdown>
          </div>
        )}
        
        {shouldCollapse && (
          <div className="mt-2 text-xs opacity-70">
            ... ({content.length - COLLAPSE_THRESHOLD} caratteri nascosti)
          </div>
        )}

        {/* Indicatore di streaming sempre visibile */}
        {isStreaming && (
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-block w-2 h-4 bg-foreground animate-pulse" />
            <span className="text-xs text-muted-foreground animate-pulse">
              Sto scrivendo...
            </span>
          </div>
        )}

        {/* LLM Provider Badge - only for assistant messages */}
        {llmBadge && !isStreaming && (
          <div className="flex items-center gap-1 mt-2">
            <Sparkles className="h-3 w-3 text-muted-foreground" />
            <Badge variant="outline" className={cn("text-xs font-medium border", llmBadge.color)}>
              {llmBadge.label}
            </Badge>
          </div>
        )}


        {content && (
          <div className={cn("mt-3 pt-2 border-t flex gap-2 flex-wrap", isUser ? "border-primary-foreground/20" : "border-border/50")}>
            {/* Show reload button for potentially truncated messages */}
            {isPotentiallyTruncated && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReloadFullMessage}
                disabled={reloadingContent}
                className="h-8 px-2 gap-1 text-xs border-yellow-500/20 bg-yellow-500/5 hover:bg-yellow-500/10"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                {reloadingContent ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Caricamento...
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3" />
                    Ricarica completo
                  </>
                )}
              </Button>
            )}
            
            {content.length > COLLAPSE_THRESHOLD && (
              <Button
                variant="ghost"
                size="sm"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsManuallyExpanded(!isExpanded);
                }}
                className={cn("h-8 px-2 gap-1 pointer-events-auto", isUser && "hover:bg-primary-foreground/10")}
              >
                {!isExpanded ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    <span className="text-xs">Mostra tutto ({content.length.toLocaleString('it-IT')} caratteri)</span>
                  </>
                ) : (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    <span className="text-xs">Mostra meno (nascondi ~{Math.max(0, content.length - 1000).toLocaleString('it-IT')} caratteri)</span>
                  </>
                )}
              </Button>
            )}

            {/* Bottoni Copy, TTS e Presentation - solo quando NON è in streaming */}
            {!isStreaming && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                  }}
                  className={cn("h-8 px-2", isUser && "hover:bg-primary-foreground/10")}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTTS();
                  }}
                  disabled={status === 'loading' && currentMessageId === id}
                  className={cn(
                    "h-8 px-2 transition-all",
                    isUser && "hover:bg-primary-foreground/10",
                    status === 'loading' && currentMessageId === id && "opacity-50 cursor-not-allowed"
                  )}
                  title={
                    status === 'loading' && currentMessageId === id
                      ? "Caricamento audio..."
                      : isTTSPlaying
                      ? "Ferma audio"
                      : "Riproduci con voce"
                  }
                >
                  {status === 'loading' && currentMessageId === id ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : isTTSPlaying ? (
                    <Square className="h-3 w-3 fill-current" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>

                {!isUser && content.length > 100 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/presentation?messageId=${id}${agentId ? `&agentId=${agentId}` : ''}`);
                    }}
                    className={cn("h-8 px-2 gap-1")}
                    title="Crea presentazione"
                  >
                    <Presentation className="h-3 w-3" />
                    <span className="text-xs hidden sm:inline">Slideshow</span>
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
