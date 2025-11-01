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
}

export const ChatMessage = ({ id, role, content, isStreaming }: ChatMessageProps) => {
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
        "flex gap-2 md:gap-3 p-3 md:p-4",
        isUser ? "bg-muted/50" : "bg-background"
      )}
    >
      <div className="flex-shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs md:text-sm font-medium">
        {isUser ? "U" : "AI"}
      </div>

      <div className="flex-1 min-w-0">
        <div className={cn("prose prose-sm max-w-none dark:prose-invert", !isExpanded && isLong && "line-clamp-3")}>
          <div className="text-sm md:text-base">
            {isUser ? (
              <div className="whitespace-pre-wrap break-words">
                {content}
              </div>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            )}
          </div>
          {isStreaming && <span className="inline-block w-2 h-4 ml-1 bg-foreground animate-pulse" />}
        </div>

        {!isUser && !isStreaming && content && (
          <div className="mt-2 flex gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-2 min-h-[44px] md:min-h-0"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTTS}
              className="h-8 px-2 min-h-[44px] md:min-h-0"
            >
              {isTTSPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>

            {isLong && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-8 px-2 min-h-[44px] md:min-h-0"
              >
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
