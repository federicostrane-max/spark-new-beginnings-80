import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Play, Square, ChevronDown, ChevronUp, Presentation, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTTS } from "@/contexts/TTSContext";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessageProps {
  id: string;
  role: "user" | "assistant";
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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasLocalOverride, setHasLocalOverride] = useState(false);
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

  useEffect(() => {
    if (forceExpanded !== undefined) {
      setHasLocalOverride(false);
      setIsCollapsed(!forceExpanded);
    }
  }, [forceExpanded]);

  // Reset justEnteredSelectionMode when exiting selection mode
  useEffect(() => {
    if (!selectionMode) {
      justEnteredSelectionMode.current = false;
    }
  }, [selectionMode]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
  const hasMoved = useRef(false);

  const handleLongPressStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (selectionMode) return;
    
    // Track initial touch position to detect scrolling
    if ('touches' in e) {
      touchStartY.current = e.touches[0].clientY;
      hasMoved.current = false;
    }
    
    setIsLongPressing(true);
    longPressTimer.current = setTimeout(() => {
      // Only trigger long press if user hasn't scrolled
      if (!hasMoved.current && onLongPress) {
        onLongPress();
        justEnteredSelectionMode.current = true; // Set flag to prevent immediate deselection
        // Vibrazione per feedback tattile (se disponibile)
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
      setIsLongPressing(false);
    }, 800); // Reduced from 1200ms to 800ms for better UX
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Detect if user is scrolling
    if (touchStartY.current) {
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current);
      if (deltaY > 10) { // 10px threshold
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
    hasMoved.current = false;
  };

  const isUser = role === "user";
  const isTTSPlaying = currentMessageId === id && status === 'playing';
  const shouldBeCollapsed = isCollapsed;
  const previewLength = 500;

  return (
    <div 
      className="mb-4 group relative touch-pan-y"
      onClick={selectionMode ? handleMessageClick : undefined}
      onTouchEnd={selectionMode ? handleMessageClick : handleLongPressEnd}
      onTouchStart={!selectionMode ? handleLongPressStart : undefined}
      onTouchMove={!selectionMode ? handleTouchMove : undefined}
      onTouchCancel={handleLongPressEnd}
      onMouseDown={!selectionMode ? handleLongPressStart : undefined}
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
          "touch-pan-y select-none",
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
          <div className="whitespace-pre-wrap break-words overflow-wrap-anywhere select-none">
            {shouldBeCollapsed && content.length > previewLength
              ? content.substring(0, previewLength) + "..."
              : content}
          </div>
        ) : (
          <div className="break-words overflow-wrap-anywhere select-none [&_*]:break-words [&_p]:my-2 [&_p]:leading-7 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:my-2 [&_strong]:font-bold [&_em]:italic [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2 [&_li]:my-1 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:rounded [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:my-2 [&_pre_code]:whitespace-pre-wrap [&_pre_code]:break-words [&_table]:w-full [&_table]:my-4 [&_table]:border-collapse [&_table]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_thead]:bg-muted/50 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-sm [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_td]:align-top [&_tr]:border-b [&_tr]:border-border">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {shouldBeCollapsed && content.length > previewLength
                ? content.substring(0, previewLength) + "..."
                : content}
            </ReactMarkdown>
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

        {/* Badge per streaming in modalità collapsed */}
        {isStreaming && shouldBeCollapsed && content.length > previewLength && (
          <div className="flex items-center gap-2 mt-2 px-2 py-1 bg-primary/10 rounded-md">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-medium text-primary">
              Continua a scrivere... (clicca Mostra tutto per vedere)
            </span>
          </div>
        )}

        {content && (
          <div className={cn("mt-3 pt-2 border-t flex gap-2 flex-wrap", isUser ? "border-primary-foreground/20" : "border-border/50")}>
            {/* Bottone Espandi/Collassa - visibile anche durante streaming */}
            {content.length > previewLength && (
              <Button
                variant="ghost"
                size="sm"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setHasLocalOverride(true);
                  setIsCollapsed(prev => !prev);
                }}
                className={cn("h-8 px-2 gap-1 pointer-events-auto", isUser && "hover:bg-primary-foreground/10")}
              >
                {shouldBeCollapsed ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    <span className="text-xs">Mostra tutto</span>
                  </>
                ) : (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    <span className="text-xs">Mostra meno</span>
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
