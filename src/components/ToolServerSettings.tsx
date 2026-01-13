import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Server, CheckCircle, XCircle, AlertCircle, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { toolServerClient } from "@/lib/tool-server";

// ──────────────────────────────────────────────────────────
// Normalizzazione URL (coerente con client.ts)
// ──────────────────────────────────────────────────────────

function normalizeToolServerUrl(input: string): string {
  if (!input) return '';
  let url = input.trim();
  // Rimuove trailing slash
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  return url;
}

type ConnectionStatus = 'connected' | 'disconnected' | 'not_configured' | 'testing';

interface ConnectionResult {
  status: ConnectionStatus;
  version?: string;
  error?: string;
  urlUsed?: string;
}

export const ToolServerSettings = () => {
  const [url, setUrl] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionResult>({ status: 'not_configured' });
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load saved URL on mount
  useEffect(() => {
    const savedUrl = localStorage.getItem('toolServerUrl') || '';
    setUrl(savedUrl);
    
    // Auto-test if URL exists
    if (savedUrl) {
      testConnectionInternal(savedUrl);
    }
  }, []);

  const testConnectionInternal = async (testUrl: string) => {
    const normalized = normalizeToolServerUrl(testUrl);
    
    if (!normalized) {
      setConnectionStatus({ status: 'not_configured' });
      return;
    }
    
    setIsTesting(true);
    setConnectionStatus({ status: 'testing' });
    
    try {
      const response = await fetch(`${normalized}/status`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        setConnectionStatus({ 
          status: 'disconnected', 
          error: `HTTP ${response.status} - Il server ha risposto ma con un errore`,
          urlUsed: normalized
        });
        return;
      }
      
      const data = await response.json();
      setConnectionStatus({ 
        status: 'connected', 
        version: data.version,
        urlUsed: normalized
      });
    } catch (error) {
      // Messaggi di errore specifici
      let errorMessage = 'Connessione fallita';
      
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Impossibile raggiungere il server';
        } else if (error.message.includes('CORS')) {
          errorMessage = 'Errore CORS - controlla la configurazione ngrok';
        } else {
          errorMessage = error.message;
        }
      }
      
      setConnectionStatus({ 
        status: 'disconnected', 
        error: errorMessage,
        urlUsed: normalized
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestConnection = () => {
    const normalized = normalizeToolServerUrl(url);
    if (!normalized) {
      toast.error("Inserisci un URL valido");
      return;
    }
    testConnectionInternal(normalized);
  };

  const handleSave = () => {
    setIsSaving(true);
    
    try {
      const normalized = normalizeToolServerUrl(url);
      toolServerClient.updateBaseUrl(normalized); // Emette evento + salva localStorage
      
      if (normalized) {
        toast.success("URL Tool Server salvato!");
        // Auto-test after save
        testConnectionInternal(normalized);
      } else {
        toast.info("URL rimosso - Tool Server non configurato");
        setConnectionStatus({ status: 'not_configured' });
      }
    } catch (error) {
      toast.error("Errore nel salvataggio");
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusBadge = () => {
    switch (connectionStatus.status) {
      case 'connected':
        return (
          <Badge variant="default" className="bg-green-500 hover:bg-green-600">
            <CheckCircle className="h-3 w-3 mr-1" />
            Connesso {connectionStatus.version ? `(${connectionStatus.version})` : ''}
          </Badge>
        );
      case 'disconnected':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Non connesso
          </Badge>
        );
      case 'testing':
        return (
          <Badge variant="secondary">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Verifica...
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-yellow-500 text-yellow-600">
            <AlertCircle className="h-3 w-3 mr-1" />
            Non configurato
          </Badge>
        );
    }
  };

  const getErrorSuggestions = () => {
    if (connectionStatus.status !== 'disconnected' || !connectionStatus.error) return null;
    
    return (
      <div className="mt-2 text-xs space-y-1">
        <p className="font-medium">Suggerimenti:</p>
        <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
          <li>Verifica che ngrok sia in esecuzione</li>
          <li>L'URL deve iniziare con <code className="bg-muted px-1 rounded">https://</code></li>
          <li>Controlla che il Tool Server sia avviato sul PC locale</li>
          <li>L'URL ngrok cambia ad ogni riavvio</li>
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* URL Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Tool Server URL</label>
        <Input
          type="url"
          placeholder="https://xxx.ngrok-free.app"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Inserisci l'URL ngrok del tuo Tool Server locale
        </p>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Status:</span>
        {getStatusBadge()}
      </div>
      
      {/* URL in uso (debug) */}
      {connectionStatus.urlUsed && (
        <div className="text-xs text-muted-foreground">
          URL testato: <code className="bg-muted px-1 rounded">{connectionStatus.urlUsed}</code>
        </div>
      )}

      {/* Error message with suggestions */}
      {connectionStatus.status === 'disconnected' && connectionStatus.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-medium">{connectionStatus.error}</div>
            {getErrorSuggestions()}
          </AlertDescription>
        </Alert>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <Button 
          variant="outline" 
          onClick={handleTestConnection}
          disabled={isTesting || !url.trim()}
        >
          {isTesting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Test Connection
        </Button>
        <Button 
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Save
        </Button>
      </div>

      {/* Info Alert */}
      <Alert>
        <Server className="h-4 w-4" />
        <AlertDescription>
          <strong>Come configurare:</strong>
          <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
            <li>Avvia Tool Server sul tuo PC (genera URL ngrok automaticamente)</li>
            <li>Copia l'URL ngrok dal terminale (es: <code className="bg-muted px-1 rounded">https://xxx.ngrok-free.app</code>)</li>
            <li>Incolla qui e clicca "Test Connection"</li>
            <li>Se connesso, clicca "Save"</li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            ⚠️ L'URL ngrok cambia ogni riavvio del Tool Server
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
};
