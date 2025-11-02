import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, Play, Pause, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTTS } from "@/contexts/TTSContext";
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
}

export const ChatMessage = ({ 
  id, 
  role, 
  content, 
  isStreaming, 
  isSelected = false,
  selectionMode = false,
  onToggleSelection 
}: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const { currentMessageId, status, playMessage, pause } = useTTS();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTTS = () => {
    if (currentMessageId === id && status === 'playing') {
      pause();
    } else {
      playMessage(id, content);
    }
  };

  const isUser = role === "user";
  const isLong = content.length > 500;
  const isTTSPlaying = currentMessageId === id && status === 'playing';

  return (
    <div 
      className={cn(
        "mb-4 flex w-full group relative",
        selectionMode ? "justify-start" : (isUser ? "justify-end" : "justify-start")
      )}
      onClick={selectionMode ? onToggleSelection : undefined}
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
          "rounded-2xl px-4 py-3 shadow-sm transition-all overflow-hidden",
          selectionMode ? "max-w-[calc(100%-3rem)] ml-8" : "max-w-[75%]",
          isUser 
            ? "bg-primary text-primary-foreground" 
            : "bg-muted text-foreground",
          isSelected && "ring-2 ring-primary"
        )}
      >
        <div className={cn("prose prose-sm max-w-none dark:prose-invert break-words overflow-wrap-anywhere", !isExpanded && isLong && "line-clamp-3")}>
          <div className="text-sm md:text-base break-words">
            {isUser ? (
              <div className="whitespace-pre-wrap break-words">
                {content}
              </div>
            ) : (
              <div className="break-words overflow-wrap-anywhere">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              </div>
            )}
          </div>
          {isStreaming && <span className="inline-block w-2 h-4 ml-1 bg-foreground animate-pulse" />}
        </div>

        {!isUser && !isStreaming && content && (
          <div className="mt-3 pt-2 border-t border-border/50 flex gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-2"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTTS}
              className="h-8 px-2"
            >
              {isTTSPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </Button>

            {isLong && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-8 px-2"
              >
                {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
