import React from 'react';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  llm_provider?: string;
}

interface ExportSelectedMessagesPDFProps {
  conversationId: string;
  agentName: string;
  selectedMessageIds: string[];
  allMessages: Message[];
}

const ExportSelectedMessagesPDF: React.FC<ExportSelectedMessagesPDFProps> = ({
  conversationId,
  agentName,
  selectedMessageIds,
  allMessages,
}) => {
  const handleExport = async () => {
    try {
      // Get selected messages with their created_at from database
      const { data: dbMessages, error } = await supabase
        .from('agent_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .in('id', selectedMessageIds)
        .order('created_at');

      if (error) throw error;

      if (!dbMessages || dbMessages.length === 0) {
        toast.error('Nessun messaggio selezionato');
        return;
      }

      const html = generatePrintHTML(agentName, dbMessages, selectedMessageIds.length);
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Impossibile aprire la finestra di stampa. Verifica le impostazioni del browser.');
        return;
      }

      printWindow.document.write(html);
      printWindow.document.close();
      
      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
      };

      toast.success(`Esportazione di ${dbMessages.length} messaggi avviata`);
    } catch (error) {
      console.error('Error exporting selected messages:', error);
      toast.error('Errore durante l\'esportazione dei messaggi selezionati');
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      className="gap-2"
      disabled={selectedMessageIds.length === 0}
    >
      <FileDown className="h-4 w-4" />
      <span className="hidden sm:inline">Esporta PDF</span>
      <span className="sm:hidden">PDF</span>
    </Button>
  );
};

function generatePrintHTML(agentName: string, messages: any[], selectedCount: number): string {
  const messagesHTML = messages.map(msg => {
    const roleLabel = msg.role === 'user' ? 'Utente' : agentName;
    const roleClass = msg.role === 'user' ? 'user-message' : 'assistant-message';
    const timestamp = new Date(msg.created_at).toLocaleString('it-IT');
    
    return `
      <div class="message ${roleClass}">
        <div class="message-header">
          <strong>${escapeHTML(roleLabel)}</strong>
          <span class="timestamp">${timestamp}</span>
        </div>
        <div class="message-content">${escapeHTML(msg.content)}</div>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html lang="it">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Chat - ${escapeHTML(agentName)} (Messaggi Selezionati)</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          color: #1a1a1a;
          padding: 40px 20px;
          max-width: 800px;
          margin: 0 auto;
        }
        
        .header {
          text-align: center;
          margin-bottom: 40px;
          padding-bottom: 20px;
          border-bottom: 2px solid #e5e5e5;
        }
        
        .header h1 {
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 10px;
          color: #0f172a;
        }
        
        .header .subtitle {
          font-size: 14px;
          color: #64748b;
          margin-top: 8px;
        }
        
        .messages-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        
        .message {
          padding: 20px;
          border-radius: 8px;
          border: 1px solid #e5e5e5;
          background: #ffffff;
          page-break-inside: avoid;
        }
        
        .user-message {
          background: #f8fafc;
          border-color: #cbd5e1;
        }
        
        .assistant-message {
          background: #fefefe;
          border-color: #e2e8f0;
        }
        
        .message-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #f1f5f9;
        }
        
        .message-header strong {
          font-size: 14px;
          font-weight: 600;
          color: #334155;
        }
        
        .timestamp {
          font-size: 12px;
          color: #94a3b8;
        }
        
        .message-content {
          font-size: 14px;
          line-height: 1.7;
          color: #1e293b;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        
        .footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 2px solid #e5e5e5;
          text-align: center;
          font-size: 12px;
          color: #94a3b8;
        }
        
        @media print {
          body {
            padding: 20px;
          }
          
          .message {
            page-break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Chat - ${escapeHTML(agentName)}</h1>
        <div class="subtitle">Messaggi selezionati: ${selectedCount} di ${messages.length}</div>
        <div class="subtitle">Esportato il ${new Date().toLocaleString('it-IT')}</div>
      </div>
      
      <div class="messages-container">
        ${messagesHTML}
      </div>
      
      <div class="footer">
        Conversazione esportata da Multi-Agent Consultant
      </div>
    </body>
    </html>
  `;
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export default ExportSelectedMessagesPDF;
