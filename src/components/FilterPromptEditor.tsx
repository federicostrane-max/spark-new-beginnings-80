import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, History, Save, Info, AlertTriangle } from 'lucide-react';

interface FilterPrompt {
  id: string;
  version_number: number;
  prompt_content: string;
  filter_version: string;
  is_active: boolean;
  created_at: string;
  notes?: string;
}

export const FilterPromptEditor = () => {
  const [activePrompt, setActivePrompt] = useState<FilterPrompt | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [filterVersion, setFilterVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<FilterPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadActivePrompt();
    loadHistory();
  }, []);

  const loadActivePrompt = async () => {
    const { data, error } = await supabase
      .from('filter_agent_prompts')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('Failed to load active prompt:', error);
      toast({
        title: 'Errore',
        description: 'Impossibile caricare il prompt attivo',
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    if (data) {
      setActivePrompt(data as FilterPrompt);
      setEditedContent(data.prompt_content);
      setFilterVersion(data.filter_version || '');
    }
    setLoading(false);
  };

  const loadHistory = async () => {
    const { data, error } = await supabase
      .from('filter_agent_prompts')
      .select('*')
      .order('version_number', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Failed to load history:', error);
      return;
    }

    setHistory((data || []) as FilterPrompt[]);
  };

  const handleSave = async () => {
    if (!editedContent.trim()) {
      toast({
        title: 'Errore',
        description: 'Il prompt non può essere vuoto',
        variant: 'destructive',
      });
      return;
    }

    // Check for required placeholder
    if (!editedContent.includes('${agent.system_prompt}')) {
      toast({
        title: 'Errore - Placeholder Mancante',
        description: 'Il prompt deve contenere il placeholder ${agent.system_prompt} per funzionare correttamente.',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('update-filter-prompt', {
        body: {
          newPromptContent: editedContent,
          filterVersion: filterVersion || undefined,
          notes: notes || undefined,
          updatedBy: userData.user?.id,
        },
      });

      if (error) throw error;

      toast({
        title: 'Successo',
        description: `Prompt aggiornato a versione ${data.version_number}`,
      });

      await loadActivePrompt();
      await loadHistory();
      setNotes('');
    } catch (error: any) {
      console.error('Save failed:', error);
      toast({
        title: 'Errore',
        description: error.message || 'Impossibile salvare il prompt',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async (promptId: string) => {
    const confirmed = confirm('Ripristinare questa versione del prompt? Questo la renderà attiva per tutti gli agenti.');
    if (!confirmed) return;

    try {
      const { error } = await supabase.rpc('activate_filter_prompt', {
        prompt_id: promptId,
      });

      if (error) throw error;

      toast({
        title: 'Successo',
        description: 'Versione ripristinata',
      });

      await loadActivePrompt();
      await loadHistory();
      setShowHistory(false);
    } catch (error: any) {
      console.error('Restore failed:', error);
      toast({
        title: 'Errore',
        description: 'Impossibile ripristinare la versione',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Filter Agent Prompt</h2>
          <p className="text-sm text-muted-foreground">
            Prompt utilizzato per estrarre requisiti strutturati dai prompt degli agenti
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activePrompt && (
            <>
              <Badge variant="outline">
                Versione {activePrompt.version_number}
              </Badge>
              {activePrompt.filter_version && (
                <Badge>{activePrompt.filter_version}</Badge>
              )}
            </>
          )}
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          <strong>⚠️ Attenzione:</strong> Le modifiche a questo prompt influenzano{' '}
          <strong>TUTTI gli agenti</strong> durante l'estrazione dei requisiti. 
          Usa <code className="bg-muted px-1 rounded">${'{agent.system_prompt}'}</code> per 
          inserire il prompt dell'agente.
        </AlertDescription>
      </Alert>

      <Card className="p-4 bg-muted/30">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            📋 NOTE INTRODUTTIVE (non editabili)
          </p>
          <p className="text-sm">
            Questo prompt è utilizzato dal sistema per estrarre automaticamente requisiti 
            strutturati dai prompt degli agenti. Viene eseguito quando un agente viene creato 
            o il suo prompt viene modificato.
          </p>
        </div>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">
            📝 PROMPT COMPLETO (Editabile)
          </Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="mr-2 h-4 w-4" />
            {showHistory ? 'Nascondi' : 'Mostra'} Storico
          </Button>
        </div>

        <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm">
            <strong>Placeholder obbligatorio:</strong> Il prompt deve contenere{' '}
            <code className="bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-1 rounded font-mono">
              {'${agent.system_prompt}'}
            </code>{' '}
            per permettere l'inserimento dinamico del prompt dell'agente durante l'analisi.
          </AlertDescription>
        </Alert>

        <Textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          className="font-mono text-xs min-h-[500px]"
          placeholder="Inserisci il prompt del filter agent..."
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Filter Version (es: v7)</Label>
            <Input
              value={filterVersion}
              onChange={(e) => setFilterVersion(e.target.value)}
              placeholder="v6"
              className="text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Note sulla modifica</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Breve descrizione delle modifiche..."
              className="text-sm"
            />
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvataggio...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Salva Nuova Versione
            </>
          )}
        </Button>
      </div>

      {showHistory && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">📚 Storia delle Versioni</h3>
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {history.map((version) => (
                <Card
                  key={version.id}
                  className={`p-3 ${version.is_active ? 'border-primary' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={version.is_active ? 'default' : 'outline'}>
                          v{version.version_number}
                        </Badge>
                        {version.filter_version && (
                          <Badge variant="secondary">{version.filter_version}</Badge>
                        )}
                        {version.is_active && (
                          <Badge variant="default">ATTIVO</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(version.created_at).toLocaleString('it-IT')}
                      </p>
                      {version.notes && (
                        <p className="text-sm mt-2">{version.notes}</p>
                      )}
                    </div>
                    {!version.is_active && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestore(version.id)}
                      >
                        Ripristina
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}

      <Card className="p-4 bg-muted/30">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            📚 STORIA DELLE VERSIONI (informativa)
          </p>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>v6 (2025-01-12): Aggiunto bibliographic_references come prerequisito bloccante</li>
            <li>v5 (2025-01-10): Migliorati filtri domain_vocabulary aggressivi</li>
            <li>v4 (2025-01-08): Aggiunta estrazione decision_patterns</li>
            <li>v3 (2025-01-05): Ottimizzazione core_concepts con importance levels</li>
          </ul>
        </div>
      </Card>
    </div>
  );
};
