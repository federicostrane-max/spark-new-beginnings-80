import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, History, Save, Info, AlertTriangle } from 'lucide-react';

type AgentType = 'general' | 'procedural' | 'narrative' | 'technical' | 'research' | 'domain-expert';

interface AlignmentPrompt {
  id: string;
  agent_type: AgentType;
  version_number: number;
  prompt_content: string;
  alignment_version: string;
  is_active: boolean;
  created_at: string;
  notes?: string;
  llm_model?: string;
}

export const AlignmentPromptEditor = () => {
  const [selectedAgentType, setSelectedAgentType] = useState<AgentType>('general');
  const [activePrompt, setActivePrompt] = useState<AlignmentPrompt | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [alignmentVersion, setAlignmentVersion] = useState('');
  const [llmModel, setLlmModel] = useState('google/gemini-2.5-flash');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<AlignmentPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { toast } = useToast();

  // Load global LLM model only once on mount
  useEffect(() => {
    loadGlobalLlmModel();
  }, []);

  useEffect(() => {
    loadActivePrompt();
    loadHistory();
  }, [selectedAgentType]);

  const loadGlobalLlmModel = async () => {
    const { data } = await supabase
      .from('alignment_agent_prompts')
      .select('llm_model')
      .eq('is_active', true)
      .eq('agent_type', 'general')
      .maybeSingle();
    
    if (data?.llm_model) {
      setLlmModel(data.llm_model);
    }
  };

  const loadActivePrompt = async () => {
    const { data, error } = await supabase
      .from('alignment_agent_prompts')
      .select('*')
      .eq('is_active', true)
      .eq('agent_type', selectedAgentType)
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
      setActivePrompt(data as AlignmentPrompt);
      setEditedContent(data.prompt_content);
      setAlignmentVersion(data.alignment_version || '');
      // DO NOT update llmModel here - it's shared globally
    } else {
      setActivePrompt(null);
      setEditedContent('');
      setAlignmentVersion('1.0');
      // DO NOT reset llmModel here - it's shared globally
    }
    setLoading(false);
  };

  const loadHistory = async () => {
    const { data, error } = await supabase
      .from('alignment_agent_prompts')
      .select('*')
      .eq('agent_type', selectedAgentType)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Failed to load history:', error);
      return;
    }

    setHistory((data || []) as AlignmentPrompt[]);
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

    // Check for required placeholders (different from filter!)
    const requiredPlaceholders = ['${requirements.', '${chunk.'];
    const missingPlaceholders = requiredPlaceholders.filter(p => !editedContent.includes(p));
    
    if (missingPlaceholders.length > 0) {
      toast({
        title: 'Errore - Placeholder Mancanti',
        description: `Il prompt deve contenere: ${missingPlaceholders.join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('update-alignment-prompt', {
        body: {
          newPromptContent: editedContent,
          alignmentVersion: alignmentVersion || undefined,
          llmModel: llmModel,
          notes: notes || undefined,
          updatedBy: userData.user?.id,
        },
      });

      if (error) throw error;

      toast({
        title: 'Successo',
        description: `Nuova versione ${data.version_number} creata e attivata`,
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
    const confirmed = confirm('Ripristinare questa versione del prompt? Questo la renderà attiva per tutte le analisi future.');
    if (!confirmed) return;

    try {
      const { error } = await supabase.rpc('activate_alignment_prompt', {
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
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Alignment Agent Prompt Manager</h2>
          <p className="text-muted-foreground">
            Gestisci i prompt di allineamento per tipo di agente
          </p>
        </div>
      </div>

      {/* Global LLM Model Selector */}
      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Label htmlFor="globalLlmModel" className="text-base font-semibold">
                Modello LLM Globale
              </Label>
              <Badge variant="outline" className="gap-1">
                <Info className="h-3 w-3" />
                Condiviso tra tutti i tipi
              </Badge>
            </div>
            <Select value={llmModel} onValueChange={setLlmModel}>
              <SelectTrigger id="globalLlmModel" className="bg-background">
                <SelectValue placeholder="Seleziona modello LLM" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                <SelectItem value="google/gemini-2.5-flash">
                  <div className="flex flex-col">
                    <span className="font-medium">Google Gemini 2.5 Flash</span>
                    <span className="text-xs text-muted-foreground">Veloce ed economico • Bilanciato</span>
                  </div>
                </SelectItem>
                <SelectItem value="google/gemini-2.5-pro">
                  <div className="flex flex-col">
                    <span className="font-medium">Google Gemini 2.5 Pro</span>
                    <span className="text-xs text-muted-foreground">Massima qualità • Ragionamento avanzato</span>
                  </div>
                </SelectItem>
                <SelectItem value="google/gemini-2.5-flash-lite">
                  <div className="flex flex-col">
                    <span className="font-medium">Google Gemini 2.5 Flash Lite</span>
                    <span className="text-xs text-muted-foreground">Ultra veloce • Costi minimi</span>
                  </div>
                </SelectItem>
                <SelectItem value="openai/gpt-5">
                  <div className="flex flex-col">
                    <span className="font-medium">OpenAI GPT-5</span>
                    <span className="text-xs text-muted-foreground">Eccellenza • Multimodale</span>
                  </div>
                </SelectItem>
                <SelectItem value="openai/gpt-5-mini">
                  <div className="flex flex-col">
                    <span className="font-medium">OpenAI GPT-5 Mini</span>
                    <span className="text-xs text-muted-foreground">Ottimo rapporto qualità/prezzo</span>
                  </div>
                </SelectItem>
                <SelectItem value="openai/gpt-5-nano">
                  <div className="flex flex-col">
                    <span className="font-medium">OpenAI GPT-5 Nano</span>
                    <span className="text-xs text-muted-foreground">Velocità massima • Alto volume</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              ℹ️ Questo modello verrà utilizzato per l'analisi di allineamento di tutti i 6 tipi di agente
            </p>
          </div>
        </div>
      </Card>

      <Tabs value={selectedAgentType} onValueChange={(value) => setSelectedAgentType(value as AgentType)}>
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="procedural">Procedural</TabsTrigger>
          <TabsTrigger value="narrative">Narrative</TabsTrigger>
          <TabsTrigger value="technical">Technical</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
          <TabsTrigger value="domain-expert">Domain Expert</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedAgentType} className="space-y-4 mt-4">
          <div className="flex items-center gap-2">
            {activePrompt ? (
              <>
                <Badge variant="default" className="gap-1">
                  <Info className="h-3 w-3" />
                  Prompt Attivo - Tipo: {selectedAgentType.toUpperCase()}
                </Badge>
                {activePrompt.alignment_version && (
                  <Badge variant="outline">{activePrompt.alignment_version}</Badge>
                )}
              </>
            ) : (
              <Badge variant="secondary">
                Nessun prompt attivo per {selectedAgentType}
              </Badge>
            )}
          </div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Attenzione:</strong> Modificare questo prompt influenzerà l'analisi
              di allineamento per tutti gli agenti di tipo <strong>{selectedAgentType}</strong>.
              <br/>
              <strong>Placeholder richiesti:</strong> 
              <code className="ml-2 bg-muted px-1 rounded">{'${requirements.'}</code>, 
              <code className="ml-2 bg-muted px-1 rounded">{'${chunk.'}</code>
            </AlertDescription>
          </Alert>

      <Card className="p-4 bg-muted/30">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            📋 NOTE INTRODUTTIVE (non editabili)
          </p>
          <p className="text-sm">
            Questo prompt è utilizzato dal sistema per analizzare ogni chunk di conoscenza e determinare
            la sua rilevanza rispetto ai requisiti estratti dall'agente. Viene eseguito durante l'analisi
            di allineamento della knowledge base.
          </p>
        </div>
      </Card>

      <div className="space-y-3">
        <Label className="text-sm font-semibold">
          📝 PROMPT COMPLETO (Editabile)
        </Label>

        <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm">
            <strong>Placeholder obbligatori:</strong> Il prompt deve contenere{' '}
            <code className="bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-1 rounded font-mono">
              {'${requirements.'}
            </code>{' '}
            e{' '}
            <code className="bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-1 rounded font-mono">
              {'${chunk.'}
            </code>{' '}
            per permettere l'inserimento dinamico dei dati durante l'analisi.
          </AlertDescription>
        </Alert>

        <Textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          className="font-mono text-xs min-h-[500px]"
          placeholder="Inserisci il prompt dell'alignment agent..."
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Alignment Version (es: v2)</Label>
            <Input
              value={alignmentVersion}
              onChange={(e) => setAlignmentVersion(e.target.value)}
              placeholder="es: v2, v2.0-experimental"
              className="text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Modello LLM</Label>
            <Select value={llmModel} onValueChange={setLlmModel} disabled={loading}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Seleziona modello" />
              </SelectTrigger>
              <SelectContent>
                {/* Lovable AI Models (Gratuiti) */}
                <SelectItem value="google/gemini-2.5-flash">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Gemini 2.5 Flash</span>
                    <span className="text-xs text-muted-foreground">Lovable AI • Gratuito • Veloce</span>
                  </div>
                </SelectItem>
                <SelectItem value="google/gemini-2.5-pro">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Gemini 2.5 Pro</span>
                    <span className="text-xs text-muted-foreground">Lovable AI • Gratuito • Avanzato</span>
                  </div>
                </SelectItem>
                <SelectItem value="google/gemini-2.5-flash-lite">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Gemini 2.5 Flash Lite</span>
                    <span className="text-xs text-muted-foreground">Lovable AI • Gratuito • Ultra veloce</span>
                  </div>
                </SelectItem>
                <SelectItem value="openai/gpt-5">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">GPT-5</span>
                    <span className="text-xs text-muted-foreground">Lovable AI • Gratuito • Flagship</span>
                  </div>
                </SelectItem>
                <SelectItem value="openai/gpt-5-mini">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">GPT-5 Mini</span>
                    <span className="text-xs text-muted-foreground">Lovable AI • Gratuito • Veloce</span>
                  </div>
                </SelectItem>
                <SelectItem value="openai/gpt-5-nano">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">GPT-5 Nano</span>
                    <span className="text-xs text-muted-foreground">Lovable AI • Gratuito • Ultra veloce</span>
                  </div>
                </SelectItem>
                
                {/* External Models (Require API Keys) */}
                <SelectItem value="deepseek/deepseek-reasoner">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">DeepSeek Reasoner ⭐</span>
                    <span className="text-xs text-muted-foreground">API DeepSeek • Reasoning profondo • Economico</span>
                  </div>
                </SelectItem>
                <SelectItem value="deepseek/deepseek-chat">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">DeepSeek Chat</span>
                    <span className="text-xs text-muted-foreground">API DeepSeek • Veloce • Economico</span>
                  </div>
                </SelectItem>
                <SelectItem value="claude-sonnet-4-5">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Claude Sonnet 4.5</span>
                    <span className="text-xs text-muted-foreground">Anthropic • Top qualità • Reasoning superiore</span>
                  </div>
                </SelectItem>
                <SelectItem value="claude-opus-4-1-20250805">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Claude Opus 4</span>
                    <span className="text-xs text-muted-foreground">Anthropic • Altissima intelligenza</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Modelli Lovable AI gratuiti • DeepSeek/Claude richiedono API key
            </p>
          </div>
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

      <Card className="p-4">
        <div 
          className="flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => setShowHistory(!showHistory)}
        >
          <h3 className="font-semibold">📚 Storia delle Versioni</h3>
          <Button variant="ghost" size="sm">
            <History className="mr-2 h-4 w-4" />
            {showHistory ? 'Nascondi' : 'Mostra'}
          </Button>
        </div>
        
        {showHistory && (
          <ScrollArea className="h-[400px] mt-4">
            <div className="space-y-3">
              {history.map((version) => (
                <Card
                  key={version.id}
                  className={`p-3 ${version.is_active ? 'border-primary' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {version.alignment_version ? (
                          <Badge variant={version.is_active ? 'default' : 'outline'}>
                            {version.alignment_version}
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            Non specificata
                          </Badge>
                        )}
                        {version.llm_model && (
                          <Badge 
                            variant="secondary" 
                            className={`text-xs ${
                              version.llm_model.startsWith('deepseek/') 
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                : version.llm_model.startsWith('google/')
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                : version.llm_model.startsWith('openai/')
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : version.llm_model.startsWith('claude') || version.llm_model.startsWith('anthropic/')
                                ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                                : ''
                            }`}
                          >
                            {version.llm_model.startsWith('deepseek/') && '🧠 '}
                            {version.llm_model.startsWith('google/') && '🔷 '}
                            {version.llm_model.startsWith('openai/') && '🤖 '}
                            {(version.llm_model.startsWith('claude') || version.llm_model.startsWith('anthropic/')) && '🔶 '}
                            {version.llm_model.split('/')[1] || version.llm_model}
                          </Badge>
                        )}
                        {version.is_active && (
                          <Badge variant="default" className="bg-green-600">
                            ATTIVO
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(version.created_at).toLocaleString('it-IT')} • Versione #{version.version_number}
                      </p>
                      {version.notes && (
                        <p className="text-sm mt-1 text-muted-foreground italic">
                          {version.notes}
                        </p>
                      )}
                      <details className="mt-2">
                        <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                          Mostra prompt completo
                        </summary>
                        <pre className="text-xs mt-2 p-2 bg-muted rounded overflow-x-auto">
                          {version.prompt_content.substring(0, 600)}...
                        </pre>
                      </details>
                    </div>
                    {!version.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
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
        )}
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
