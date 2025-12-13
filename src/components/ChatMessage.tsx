import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Play, Square, ChevronDown, ChevronUp, Presentation, Sparkles, Loader2, AlertCircle, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTTS } from "@/contexts/TTSContext";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Lazy load heavy dialog component
const DeepDiveVideoDialog = lazy(() => import("@/components/DeepDiveVideoDialog").then(m => ({ default: m.DeepDiveVideoDialog })));

interface VideoDocumentInfo {
  document_id: string;
  file_name: string;
  file_path: string;
  storage_bucket: string;
  processing_metadata?: {
    director_prompt_preview?: string;
    model_used?: string;
  };
}

interface MessageMetadata {
  has_knowledge_context?: boolean;
  knowledge_stats?: {
    chunks_found: number;
    top_similarity: number;
    documents_used: number;
  };
  tools_used?: string[];
  source_reliability?: 'high' | 'medium' | 'low';
  video_documents_available?: VideoDocumentInfo[];
}

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
  metadata?: MessageMetadata;
  videoDocumentsForAgent?: VideoDocumentInfo[];
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
  llmProvider,
  metadata,
  videoDocumentsForAgent
}: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  // null = segui forceExpanded, true/false = override manuale
  const [isManuallyExpanded, setIsManuallyExpanded] = useState<boolean | null>(null);
  const [justReceivedLongContent, setJustReceivedLongContent] = useState(false);
  const [reloadingContent, setReloadingContent] = useState(false);
  const [showDeepDiveDialog, setShowDeepDiveDialog] = useState(false);
  const prevContentLengthRef = useRef(content.length);
  const { currentMessageId, status, playMessage, stop } = useTTS();
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const justEnteredSelectionMode = useRef(false);
  const navigate = useNavigate();

  // Helper function to determine source reliability badge
  const getSourceBadge = () => {
    if (role === 'user' || !metadata) return null;
    
    const { has_knowledge_context, knowledge_stats, tools_used, source_reliability } = metadata;
    
    // Scenario 1: Based on documents (GREEN)
    if (has_knowledge_context && knowledge_stats) {
      return {
        icon: '✓',
        label: `${knowledge_stats.documents_used} documenti`,
        color: 'bg-green-500/10 text-green-600 border-green-500/20',
        tooltip: `Risposta basata su ${knowledge_stats.chunks_found} chunk da ${knowledge_stats.documents_used} documenti. Similarity: ${(knowledge_stats.top_similarity * 100).toFixed(0)}%`,
        isWarning: false
      };
    }
    
    // Scenario 2: Used external tools (BLUE)
    if (tools_used && tools_used.length > 0) {
      return {
        icon: '🔍',
        label: `Tool: ${tools_used[0]}`,
        color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
        tooltip: `Tool usati: ${tools_used.join(', ')}`,
        isWarning: false
      };
    }
    
    // Scenario 3: NO KNOWLEDGE BASE - ALERT (YELLOW)
    if (source_reliability === 'low') {
      return {
        icon: '⚠️',
        label: 'Conoscenza generale',
        color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
        tooltip: 'Questa risposta non è basata su documenti nella knowledge base. Potrebbe essere imprecisa o inventata.',
        isWarning: true
      };
    }
    
    return null;
  };
  
  const sourceBadge = getSourceBadge();
  
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

  // Track if auto-expand already happened to prevent reset from overriding it
  const autoExpandedRef = useRef(false);

  // FIX 3: Espansione al primo render di messaggi lunghi già completati
  // MUST run BEFORE reset effect to set autoExpandedRef
  useEffect(() => {
    const COLLAPSE_THRESHOLD = 1000;
    if (!isStreaming && content.length > COLLAPSE_THRESHOLD && isManuallyExpanded === null) {
      console.log(`📖 [Message ${id.slice(0,8)}] Long message detected at mount (${content.length} chars) - auto-expanding`);
      setIsManuallyExpanded(true);
      autoExpandedRef.current = true;
    }
  }, []); // Empty deps = solo al mount

  // Reset override manuale quando forceExpanded cambia (comando globale)
  // Smart logic: allow global commands, but protect auto-expanded on initial flash
  useEffect(() => {
    // Se forceExpanded è TRUE (Espandi tutti), resetta sempre per seguire il comando
    if (forceExpanded === true) {
      console.log(`🔓 [Message ${id.slice(0,8)}] Global expand command - resetting override`);
      setIsManuallyExpanded(null);
      return;
    }
    
    // Se forceExpanded è FALSE/undefined E il messaggio era auto-espanso, proteggi
    if (autoExpandedRef.current) {
      console.log(`🛡️ [Message ${id.slice(0,8)}] Skipping reset - was auto-expanded`);
      return;
    }
    
    setIsManuallyExpanded(null);
  }, [forceExpanded, id]);

  // Reset justEnteredSelectionMode when exiting selection mode
  useEffect(() => {
    if (!selectionMode) {
      justEnteredSelectionMode.current = false;
    }
  }, [selectionMode]);

  // FIX 1: Espansione quando finisce lo streaming con contenuto lungo
  useEffect(() => {
    const COLLAPSE_THRESHOLD = 1000;
    // Quando finisce lo streaming E il messaggio è lungo → forza espansione
    if (!isStreaming && content.length > COLLAPSE_THRESHOLD && prevContentLengthRef.current < content.length) {
      console.log(`✅ [Message ${id.slice(0,8)}] Streaming completed with ${content.length} chars - auto-expanding`);
      setIsManuallyExpanded(true);
      // Non usiamo più justReceivedLongContent per evitare interferenze con l'espansione manuale
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
      setIsManuallyExpanded(true);
      // Non usiamo più justReceivedLongContent per evitare interferenze con l'espansione manuale
    }
    
    prevContentLengthRef.current = currentLength;
  }, [content.length, id]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReloadFullMessage = async () => {
    if (!id) return;
    setReloadingContent(true);
    
    console.log(`🔄 [Reload] Fetching full content for message ${id.slice(0,8)} (current: ${content.length} chars)`);
    
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase
        .from('agent_messages')
        .select('content')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      
      const dbContentLength = data?.content?.length || 0;
      console.log(`📊 [Reload] DB content length: ${dbContentLength} vs displayed: ${content.length}`);
      
      if (data && dbContentLength > content.length) {
        console.log(`✅ [Reload] Found ${dbContentLength - content.length} more chars in DB, reloading page...`);
        window.location.reload();
      } else {
        console.log(`ℹ️ [Reload] No additional content found in DB`);
      }
    } catch (err) {
      console.error('❌ [Reload] Error:', err);
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
  // Priorità assoluta a isManuallyExpanded quando non è null
  const isExpanded = isManuallyExpanded !== null 
    ? isManuallyExpanded 
    : (justReceivedLongContent ? true : forceExpanded ?? true);
  
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
          <>
            <div className="whitespace-pre-wrap break-words overflow-wrap-anywhere select-text">
              {displayContent}
            </div>
            
            {/* Deep Dive Button for User Messages */}
            {videoDocumentsForAgent && videoDocumentsForAgent.length > 0 && (
              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-primary-foreground/20">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeepDiveDialog(true);
                  }}
                  className="h-7 gap-1 text-xs border-primary-foreground/30 bg-primary-foreground/10 hover:bg-primary-foreground/20"
                >
                  <Video className="h-3 w-3" />
                  Cerca nel Video
                </Button>
              </div>
            )}
          </>
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

        {/* Source Reliability Badge - only for assistant messages */}
        {sourceBadge && !isStreaming && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-sm">{sourceBadge.icon}</span>
              <Badge 
                variant="outline" 
                className={cn(
                  "text-xs font-medium border cursor-help",
                  sourceBadge.color,
                  sourceBadge.isWarning && "animate-pulse"
                )}
                title={sourceBadge.tooltip}
              >
                {sourceBadge.label}
              </Badge>
              {sourceBadge.isWarning && (
                <span className="text-xs text-yellow-600 ml-1">
                  (verifica accuratezza)
                </span>
              )}
            </div>
            
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
                  // Toggle esplicito basato su isManuallyExpanded, non su isExpanded calcolato
                  const currentState = isManuallyExpanded ?? false;
                  setIsManuallyExpanded(!currentState);
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
      
      {/* Deep Dive Video Dialog */}
      {showDeepDiveDialog && videoDocumentsForAgent && (
        <DeepDiveVideoDialog
          isOpen={showDeepDiveDialog}
          onClose={() => setShowDeepDiveDialog(false)}
          videoDocuments={videoDocumentsForAgent}
          suggestedQuery={content}
          agentId={agentId}
        />
      )}
    </div>
  );
};
