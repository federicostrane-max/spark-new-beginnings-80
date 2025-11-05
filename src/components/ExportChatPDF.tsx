import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface ExportChatPDFProps {
  conversationId: string;
  agentName: string;
  messages: Message[];
}

export const ExportChatPDF = ({ conversationId, agentName, messages }: ExportChatPDFProps) => {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (messages.length === 0) {
      toast.error("Nessun messaggio da esportare");
      return;
    }

    setExporting(true);
    
    try {
      // Crea il contenuto HTML formattato
      const htmlContent = generateHTMLContent(agentName, messages);
      
      // Chiama l'edge function per generare il PDF
      const { data, error } = await supabase.functions.invoke('export-chat-pdf', {
        body: {
          conversationId,
          agentName,
          htmlContent,
        }
      });

      if (error) throw error;

      if (data?.url) {
        // Scarica il PDF
        const link = document.createElement('a');
        link.href = data.url;
        link.download = `chat_${agentName}_${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast.success("Chat esportata con successo!");
      }
    } catch (error) {
      console.error("Errore durante l'esportazione:", error);
      toast.error("Errore durante l'esportazione della chat");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button 
      variant="outline" 
      size="sm" 
      onClick={handleExport}
      disabled={exporting || messages.length === 0}
    >
      {exporting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Esportazione...
        </>
      ) : (
        <>
          <FileDown className="mr-2 h-4 w-4" />
          Esporta PDF
        </>
      )}
    </Button>
  );
};

function generateHTMLContent(agentName: string, messages: Message[]): string {
  const messagesHTML = messages
    .map(msg => {
      const time = new Date(msg.created_at).toLocaleString('it-IT');
      const isUser = msg.role === 'user';
      const speaker = isUser ? 'Utente' : agentName;
      const bgColor = isUser ? '#f0f9ff' : '#f0fdf4';
      const borderColor = isUser ? '#0ea5e9' : '#22c55e';
      
      return `
        <div style="margin-bottom: 20px; padding: 15px; background-color: ${bgColor}; border-left: 4px solid ${borderColor}; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <strong style="font-size: 16px; color: ${borderColor};">${speaker}</strong>
            <span style="font-size: 12px; color: #6b7280;">${time}</span>
          </div>
          <div style="white-space: pre-wrap; line-height: 1.6; color: #1f2937;">
            ${escapeHTML(msg.content)}
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Chat - ${agentName}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #ffffff;
            color: #1f2937;
          }
          h1 {
            text-align: center;
            color: #1f2937;
            margin-bottom: 10px;
            font-size: 28px;
          }
          .subtitle {
            text-align: center;
            color: #6b7280;
            margin-bottom: 40px;
            font-size: 14px;
          }
          .footer {
            margin-top: 60px;
            text-align: center;
            font-size: 12px;
            color: #9ca3af;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
          }
        </style>
      </head>
      <body>
        <h1>Conversazione con ${agentName}</h1>
        <div class="subtitle">
          Esportato il ${new Date().toLocaleString('it-IT')} • 
          ${messages.length} messaggi
        </div>
        ${messagesHTML}
        <div class="footer">
          Questa conversazione è stata esportata dal sistema Multi-Agent Consultant
        </div>
      </body>
    </html>
  `;
}

function escapeHTML(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
