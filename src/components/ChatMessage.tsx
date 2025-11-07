import { useState, useEffect, useRef, useMemo } from "react";
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
  const { currentMessageId, status, playMessage, stop } = useTTS();
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const justEnteredSelectionMode = useRef(false);
  const navigate = useNavigate();
  
  // State for progressive chunk rendering
  const [visibleChunks, setVisibleChunks] = useState(3);

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
  const isSystem = role === "system";
  const isTTSPlaying = currentMessageId === id && status === 'playing';
  
  // Logica semplice e chiara: override manuale > forceExpanded > default espanso
  const isExpanded = isManuallyExpanded !== null 
    ? isManuallyExpanded  // Override manuale ha priorità assoluta
    : (forceExpanded ?? true);  // Default: espanso se forceExpanded non è definito
  
  // Preview intelligente: SOLO 2-3 paragrafi con massimo 1000 caratteri
  const getPreviewContent = (text: string): string => {
    const paragraphs = text.split('\n\n').filter(p => p.trim());
    
    // Se ci sono 2 o meno paragrafi, mostra tutto
    if (paragraphs.length <= 2) return text;
    
    // Mostra SOLO i primi 2 paragrafi come preview
    const preview = paragraphs.slice(0, 2).join('\n\n');
    
    // Se i primi 2 paragrafi sono troppo lunghi (> 1500 caratteri),
    // taglia a 1000 caratteri esatti con ellipsis
    if (preview.length > 1500) {
      return text.substring(0, 1000) + '...';
    }
    
    // Se l'anteprima è corta (< 500 caratteri), aggiungi il 3° paragrafo
    if (preview.length < 500 && paragraphs.length > 2) {
      return paragraphs.slice(0, 3).join('\n\n');
    }
    
    return preview;
  };
  
  // Funzione per dividere intelligentemente il markdown in chunk
  const splitMarkdownIntelligently = (markdown: string, maxChunkSize: number = 5000): string[] => {
    if (markdown.length <= maxChunkSize) return [markdown];
    
    const chunks: string[] = [];
    let currentPos = 0;
    
    while (currentPos < markdown.length) {
      let chunkEnd = Math.min(currentPos + maxChunkSize, markdown.length);
      
      // Se non siamo alla fine, cerca un buon punto di divisione
      if (chunkEnd < markdown.length) {
        // Cerca il punto di divisione più vicino in questo ordine:
        // 1. Fine di un code block (```)
        // 2. Fine di un paragrafo (\n\n)
        // 3. Fine di una riga (\n)
        // 4. Spazio
        
        const searchArea = markdown.substring(currentPos, Math.min(chunkEnd + 500, markdown.length));
        
        const codeBlockEnd = searchArea.indexOf('\n```\n');
        const doubleNewline = searchArea.indexOf('\n\n');
        const singleNewline = searchArea.lastIndexOf('\n');
        const space = searchArea.lastIndexOf(' ');
        
        if (codeBlockEnd !== -1 && codeBlockEnd < 500) {
          chunkEnd = currentPos + codeBlockEnd + 4;
        } else if (doubleNewline !== -1) {
          chunkEnd = currentPos + doubleNewline + 2;
        } else if (singleNewline !== -1) {
          chunkEnd = currentPos + singleNewline + 1;
        } else if (space !== -1) {
          chunkEnd = currentPos + space + 1;
        }
      }
      
      chunks.push(markdown.substring(currentPos, chunkEnd));
      currentPos = chunkEnd;
    }
    
    return chunks;
  };
  
  const PREVIEW_THRESHOLD = 800;
  const MARKDOWN_CHUNK_THRESHOLD = 10000;
  const shouldShowPreview = !isExpanded && content.length > PREVIEW_THRESHOLD;
  const displayContent = shouldShowPreview ? getPreviewContent(content) : content;
  
  // Memoizza i chunk per evitare ricalcoli ad ogni render
  const markdownChunks = useMemo(() => {
    if (displayContent.length <= MARKDOWN_CHUNK_THRESHOLD) {
      return [displayContent];
    }
    
    const startTime = performance.now();
    console.log(`🔨 [ChatMessage ${id.slice(0,8)}] Splitting markdown`, {
      displayContentLength: displayContent.length,
      threshold: MARKDOWN_CHUNK_THRESHOLD,
      willSplit: true
    });
    
    const chunks = splitMarkdownIntelligently(displayContent, 10000);
    
    const elapsed = performance.now() - startTime;
    console.log(`✅ [ChatMessage ${id.slice(0,8)}] Chunking completed in ${elapsed.toFixed(2)}ms`, {
      totalChunks: chunks.length,
      chunkSizes: chunks.map((c, i) => ({ 
        chunk: i + 1, 
        size: c.length,
        startsAt: chunks.slice(0, i).reduce((sum, ch) => sum + ch.length, 0)
      })),
      totalLength: chunks.reduce((sum, c) => sum + c.length, 0)
    });
    
    return chunks;
  }, [displayContent, id]);

  // Componente helper per logging del rendering di ogni chunk
  const ChunkedMarkdown = ({ chunk, index, total }: { chunk: string; index: number; total: number }) => {
    const chunkRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
      if (chunkRef.current) {
        console.log(`📦 [ChatMessage ${id.slice(0,8)}] Chunk ${index + 1}/${total} rendered`, {
          chunkLength: chunk.length,
          domHeight: chunkRef.current.offsetHeight
        });
      }
    }, [chunk, index, total]);
    
    return (
      <div ref={chunkRef}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {chunk}
        </ReactMarkdown>
      </div>
    );
  };
  
  // Progressive chunk loading - load 2 chunks at a time with 50ms delay
  useEffect(() => {
    if (visibleChunks < markdownChunks.length && !isStreaming) {
      const timeoutId = setTimeout(() => {
        setVisibleChunks(prev => Math.min(prev + 2, markdownChunks.length));
      }, 50);
      
      return () => clearTimeout(timeoutId);
    }
  }, [visibleChunks, markdownChunks.length, isStreaming]);
  
  // Reset visible chunks ONLY when streaming ends or content changes significantly
  // Avoid resetting during streaming to prevent infinite loops
  const prevIsStreamingRef = useRef(isStreaming);
  const prevContentLengthRef = useRef(content.length);
  
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    const prevContentLength = prevContentLengthRef.current;
    
    // Only reset when:
    // 1. Streaming just ended (was streaming, now not streaming)
    // 2. Content changed significantly when NOT streaming (e.g., user expanded/collapsed)
    const streamingJustEnded = wasStreaming && !isStreaming;
    const contentChangedWhileNotStreaming = !isStreaming && Math.abs(content.length - prevContentLength) > 100;
    
    if (streamingJustEnded || contentChangedWhileNotStreaming) {
      const initialVisible = markdownChunks.length > 5 ? 3 : markdownChunks.length;
      setVisibleChunks(initialVisible);
      
      console.log(`🔄 [ChatMessage ${id.slice(0,8)}] Resetting visible chunks`, {
        totalChunks: markdownChunks.length,
        initialVisible,
        reason: streamingJustEnded ? 'streaming ended' : 'content changed',
        contentLength: content.length
      });
    }
    
    prevIsStreamingRef.current = isStreaming;
    prevContentLengthRef.current = content.length;
  }, [isStreaming, content.length, markdownChunks.length, id]);
  
  // Log progress of progressive rendering
  useEffect(() => {
    if (markdownChunks.length > 1) {
      console.log(`📦 [ChatMessage ${id.slice(0,8)}] Progressive rendering`, {
        visibleChunks,
        totalChunks: markdownChunks.length,
        progress: `${((visibleChunks / markdownChunks.length) * 100).toFixed(1)}%`,
        isComplete: visibleChunks >= markdownChunks.length
      });
    }
  }, [visibleChunks, markdownChunks.length, id]);
  
  // Log dettagliato ad ogni render
  useEffect(() => {
    const renderTime = new Date().toISOString();
    console.log(`🎨 [ChatMessage ${id.slice(0,8)}] RENDER at ${renderTime}`, {
      'Content length': content.length,
      'Display length': displayContent.length,
      'Is expanded': isExpanded,
      'Is streaming': isStreaming,
      'Should show preview': shouldShowPreview,
      'Chunk count': markdownChunks.length,
      'Visible chunks': visibleChunks,
      'Will use chunked rendering': displayContent.length > MARKDOWN_CHUNK_THRESHOLD
    });
  }, [content.length, displayContent.length, isExpanded, isStreaming, markdownChunks.length, visibleChunks, shouldShowPreview, id]);

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
            {displayContent}
            {shouldShowPreview && (
              <div className="mt-2 text-xs opacity-70">
                ... ({content.length - displayContent.length} caratteri nascosti)
              </div>
            )}
          </div>
        ) : (
          <div className="break-words overflow-wrap-anywhere select-none [&_*]:break-words [&_p]:my-2 [&_p]:leading-7 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:my-2 [&_strong]:font-bold [&_em]:italic [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2 [&_li]:my-1 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:rounded [&_pre]:overflow-visible [&_pre]:max-h-none [&_pre]:whitespace-pre-wrap [&_pre]:my-2 [&_pre_code]:whitespace-pre-wrap [&_pre_code]:break-words [&_table]:w-full [&_table]:my-4 [&_table]:border-collapse [&_table]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_thead]:bg-muted/50 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-sm [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_td]:align-top [&_tr]:border-b [&_tr]:border-border">
            {/* Visual feedback durante streaming incrementale */}
            {isStreaming && markdownChunks.length > 1 && (
              <div className="mb-2 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-600 animate-pulse">
                ⏳ Ricevendo contenuto... ({content.length.toLocaleString('it-IT')} caratteri)
              </div>
            )}
            
            {displayContent.length > MARKDOWN_CHUNK_THRESHOLD ? (
              <>
                {markdownChunks.slice(0, visibleChunks).map((chunk, idx) => (
                  <div key={idx}>
                    <ChunkedMarkdown chunk={chunk} index={idx} total={markdownChunks.length} />
                    {idx < visibleChunks - 1 && (
                      <div className="my-1 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-30" />
                    )}
                  </div>
                ))}
                
                {/* Progress indicator when still loading chunks */}
                {visibleChunks < markdownChunks.length && (
                  <div className="mt-3 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg animate-pulse">
                    <div className="flex items-center justify-between text-xs text-blue-600 mb-2">
                      <span className="font-medium">⏳ Caricamento sezioni...</span>
                      <span className="font-mono">{visibleChunks}/{markdownChunks.length}</span>
                    </div>
                    <div className="h-1.5 bg-blue-500/20 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 transition-all duration-300 ease-out"
                        style={{ width: `${(visibleChunks / markdownChunks.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                
                {/* Info badge when fully loaded */}
                {visibleChunks >= markdownChunks.length && (
                  <div className="mt-2 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-600">
                    ℹ️ Messaggio lungo ({displayContent.length.toLocaleString('it-IT')} caratteri, {markdownChunks.length} sezioni)
                    {!isStreaming && content.length !== displayContent.length && (
                      <span className="ml-1 text-orange-600">
                        • {(content.length - displayContent.length).toLocaleString('it-IT')} caratteri ancora da mostrare
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            )}
            
            {shouldShowPreview && (
              <div className="mt-2 text-xs opacity-70">
                ... ({content.length - displayContent.length} caratteri nascosti)
              </div>
            )}
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
        {isStreaming && shouldShowPreview && (
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
            {content.length > PREVIEW_THRESHOLD && (
              <Button
                variant="ghost"
                size="sm"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  // Toggle: se era null (default), diventa !isExpanded, altrimenti toggle
                  setIsManuallyExpanded(prev => prev === null ? !isExpanded : !prev);
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
