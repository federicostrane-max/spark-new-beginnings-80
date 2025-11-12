import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { FileCode2, Info, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';

interface ExtractionPromptDialogProps {
  children?: React.ReactNode;
}

interface FilterPrompt {
  version_number: number;
  filter_version: string;
  prompt_content: string;
  is_active: boolean;
  created_at: string;
}

export const ExtractionPromptDialog = ({ children }: ExtractionPromptDialogProps) => {
  const [activePrompt, setActivePrompt] = useState<FilterPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadActivePrompt();
    }
  }, [isOpen]);

  const loadActivePrompt = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('filter_agent_prompts')
        .select('*')
        .eq('is_active', true)
        .single();

      if (error) throw error;
      setActivePrompt(data);
    } catch (error) {
      console.error('Error loading active prompt:', error);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm">
            <FileCode2 className="mr-2 h-4 w-4" />
            Filter Agent
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5" />
            Prompt di Estrazione Task Requirements
            {activePrompt && (
              <Badge variant="secondary">{activePrompt.filter_version}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Questo è il prompt interno usato dall'AI per estrarre i requisiti dal system prompt dell'agente
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="h-[70vh] pr-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Caricamento prompt attivo...</span>
            </div>
          ) : activePrompt ? (
            <div className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Questo prompt definisce come l'AI analizza il system prompt per estrarre i requisiti.
                  Versione attiva: <strong>{activePrompt.filter_version}</strong> (v{activePrompt.version_number})
                </AlertDescription>
              </Alert>

              <div className="space-y-4 text-sm">
                <section className="space-y-2">
                  <h3 className="font-semibold text-base">📋 Prompt Completo (Dal Database)</h3>
                  <div className="bg-muted p-4 rounded-lg space-y-4 font-mono text-xs whitespace-pre-wrap">
                    {activePrompt.prompt_content}
                  </div>
                </section>

                <section className="space-y-2 border-t pt-4">
                  <h3 className="font-semibold text-base">ℹ️ Informazioni Versione</h3>
                  <div className="text-xs space-y-1">
                    <p><strong>Versione:</strong> {activePrompt.filter_version} (numero {activePrompt.version_number})</p>
                    <p><strong>Salvata:</strong> {new Date(activePrompt.created_at).toLocaleString('it-IT')}</p>
                    <p><strong>Stato:</strong> <Badge variant="secondary">Attiva</Badge></p>
                  </div>
                </section>
              </div>
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>
                Nessun prompt attivo trovato. Configura il Filter Agent dalla pagina Admin.
              </AlertDescription>
            </Alert>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
