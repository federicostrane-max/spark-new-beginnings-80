import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Globe, Play, X } from "lucide-react";

export const AirtopBrowserAutomation = () => {
  const { toast } = useToast();
  const [sessionId, setSessionId] = useState<string>("");
  const [url, setUrl] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleCreateSession = async () => {
    setIsLoading(true);
    setResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('airtop-browser-automation', {
        body: { action: 'create_session' }
      });

      if (error) throw error;

      if (data.success) {
        setSessionId(data.sessionId);
        setResult(data);
        toast({
          title: "Sessione creata",
          description: `ID Sessione: ${data.sessionId}`,
        });
      } else {
        throw new Error(data.error || 'Failed to create session');
      }
    } catch (error: any) {
      console.error('Create session error:', error);
      toast({
        variant: "destructive",
        title: "Errore",
        description: error.message || "Impossibile creare la sessione browser",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = async () => {
    if (!sessionId || !url) {
      toast({
        variant: "destructive",
        title: "Errore",
        description: "Inserisci un ID sessione e un URL",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('airtop-browser-automation', {
        body: { 
          action: 'navigate',
          sessionId,
          url
        }
      });

      if (error) throw error;

      if (data.success) {
        setResult(data);
        toast({
          title: "Navigazione completata",
          description: data.message,
        });
      } else {
        throw new Error(data.error || 'Failed to navigate');
      }
    } catch (error: any) {
      console.error('Navigate error:', error);
      toast({
        variant: "destructive",
        title: "Errore",
        description: error.message || "Impossibile navigare all'URL specificato",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecuteTask = async () => {
    if (!sessionId || !prompt) {
      toast({
        variant: "destructive",
        title: "Errore",
        description: "Inserisci un ID sessione e un prompt",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('airtop-browser-automation', {
        body: { 
          action: 'execute_task',
          sessionId,
          prompt
        }
      });

      if (error) throw error;

      if (data.success) {
        setResult(data);
        toast({
          title: "Task eseguito",
          description: "Il task è stato completato con successo",
        });
      } else {
        throw new Error(data.error || 'Failed to execute task');
      }
    } catch (error: any) {
      console.error('Execute task error:', error);
      toast({
        variant: "destructive",
        title: "Errore",
        description: error.message || "Impossibile eseguire il task",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseSession = async () => {
    if (!sessionId) {
      toast({
        variant: "destructive",
        title: "Errore",
        description: "Inserisci un ID sessione",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('airtop-browser-automation', {
        body: { 
          action: 'close_session',
          sessionId
        }
      });

      if (error) throw error;

      if (data.success) {
        setResult(data);
        setSessionId("");
        toast({
          title: "Sessione chiusa",
          description: "La sessione browser è stata chiusa con successo",
        });
      } else {
        throw new Error(data.error || 'Failed to close session');
      }
    } catch (error: any) {
      console.error('Close session error:', error);
      toast({
        variant: "destructive",
        title: "Errore",
        description: error.message || "Impossibile chiudere la sessione",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Airtop.ai Browser Automation</CardTitle>
          <CardDescription>
            Crea sessioni browser automatizzate e esegui task con AI
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Session Management */}
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Session ID (verrà generato automaticamente)"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                onClick={handleCreateSession}
                disabled={isLoading}
                variant="outline"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Crea Sessione"
                )}
              </Button>
              {sessionId && (
                <Button
                  onClick={handleCloseSession}
                  disabled={isLoading}
                  variant="destructive"
                >
                  <X className="h-4 w-4 mr-2" />
                  Chiudi
                </Button>
              )}
            </div>
          </div>

          {/* Navigation */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Naviga a URL</label>
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isLoading || !sessionId}
              />
              <Button
                onClick={handleNavigate}
                disabled={isLoading || !sessionId || !url}
                variant="outline"
              >
                <Globe className="h-4 w-4 mr-2" />
                Naviga
              </Button>
            </div>
          </div>

          {/* Task Execution */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Esegui Task AI</label>
            <Textarea
              placeholder="Descrivi il task che vuoi eseguire (es: 'Cerca React sulla pagina e copia il primo risultato')"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isLoading || !sessionId}
              rows={4}
            />
            <Button
              onClick={handleExecuteTask}
              disabled={isLoading || !sessionId || !prompt}
              className="w-full"
            >
              <Play className="h-4 w-4 mr-2" />
              Esegui Task
            </Button>
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Risultato</label>
              <pre className="bg-muted p-4 rounded-lg overflow-auto max-h-96 text-sm">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Come usare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. <strong>Crea Sessione</strong>: Clicca su "Crea Sessione" per avviare una nuova sessione browser.</p>
          <p>2. <strong>Naviga</strong>: Inserisci un URL e clicca su "Naviga" per aprire la pagina nella sessione.</p>
          <p>3. <strong>Esegui Task</strong>: Descrivi un task in linguaggio naturale e l'AI lo eseguirà nel browser.</p>
          <p>4. <strong>Chiudi</strong>: Quando hai finito, chiudi la sessione per liberare le risorse.</p>
          <div className="mt-4 p-3 bg-primary/10 rounded-lg">
            <p className="text-primary font-medium">💡 Esempi di task:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Compila il form di contatto con nome e email</li>
              <li>Cerca "intelligenza artificiale" e copia i primi 3 risultati</li>
              <li>Trova il prezzo del prodotto sulla pagina</li>
              <li>Fai screenshot della sezione hero</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
