import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, X } from "lucide-react";
import { VoiceInput } from "./VoiceInput";
import { AttachmentUpload } from "./AttachmentUpload";

interface ChatInputProps {
  onSend: (message: string, attachments?: Array<{ url: string; name: string; type: string }>) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput = ({ onSend, disabled, placeholder = "Type your message..." }: ChatInputProps) => {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Array<{ url: string; name: string; type: string }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      onSend(input.trim(), attachments.length > 0 ? attachments : undefined);
      setInput("");
      setAttachments([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
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

  return (
    <div className="space-y-2">
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
      <div className="flex items-end gap-2 p-3 border rounded-2xl bg-background shadow-lg">
        <VoiceInput onTranscription={handleTranscription} disabled={disabled} />
        
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="min-h-[44px] max-h-[200px] resize-none border-0 focus-visible:ring-0 shadow-none bg-transparent"
          rows={1}
        />

        <AttachmentUpload onAttachmentAdded={handleAttachment} disabled={disabled} />
        
        <Button
          type="button"
          onClick={() => handleSubmit()}
          disabled={disabled || (!input.trim() && attachments.length === 0)}
          size="icon"
          className="flex-shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
