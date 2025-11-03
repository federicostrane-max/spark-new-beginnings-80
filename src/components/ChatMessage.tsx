import { useState, useEffect } from "react";
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
  forceExpanded?: boolean;
}

export const ChatMessage = ({ 
  id, 
  role, 
  content, 
  isStreaming, 
  isSelected = false,
  selectionMode = false,
  onToggleSelection,
  forceExpanded
}: ChatMessageProps) => {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hasLocalOverride, setHasLocalOverride] = useState(false);
  const { currentMessageId, status, playMessage, pause } = useTTS();

  useEffect(() => {
    if (forceExpanded !== undefined) {
      setHasLocalOverride(false);
    }
  }, [forceExpanded]);

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
  const isTTSPlaying = currentMessageId === id && status === 'playing';
  const shouldBeCollapsed = hasLocalOverride 
    ? isCollapsed 
    : (forceExpanded === true ? false : (forceExpanded === false ? true : isCollapsed));
  const previewLength = 150;

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
          "rounded-2xl px-4 py-3 shadow-sm transition-all w-full",
          selectionMode ? "max-w-[calc(100%-3rem)] ml-8" : "max-w-[85%] md:max-w-[75%]",
          isUser 
            ? "bg-primary text-primary-foreground" 
            : "bg-muted text-foreground",
          isSelected && "ring-2 ring-primary"
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words overflow-wrap-anywhere">
            {shouldBeCollapsed && content.length > previewLength
              ? content.substring(0, previewLength) + "..."
              : content}
            {isStreaming && <span className="inline-block w-2 h-4 ml-1 bg-foreground animate-pulse" />}
          </div>
        ) : (
          <div className="break-words [&_*]:break-words [&_p]:my-2 [&_p]:leading-7 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:my-2 [&_strong]:font-bold [&_em]:italic [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ml-6 [&_ol]:my-2 [&_li]:my-1 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:break-all [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {shouldBeCollapsed && content.length > previewLength
                ? content.substring(0, previewLength) + "..."
                : content}
            </ReactMarkdown>
            {isStreaming && <span className="inline-block w-2 h-4 ml-1 bg-foreground animate-pulse" />}
          </div>
        )}

        {!isStreaming && content && (
          <div className={cn("mt-3 pt-2 border-t flex gap-2 flex-wrap", isUser ? "border-primary-foreground/20" : "border-border/50")}>
            {content.length > previewLength && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHasLocalOverride(true);
                  setIsCollapsed(!isCollapsed);
                }}
                className={cn("h-8 px-2", isUser && "hover:bg-primary-foreground/10")}
              >
                {shouldBeCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className={cn("h-8 px-2", isUser && "hover:bg-primary-foreground/10")}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTTS}
              className={cn("h-8 px-2", isUser && "hover:bg-primary-foreground/10")}
            >
              {isTTSPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
