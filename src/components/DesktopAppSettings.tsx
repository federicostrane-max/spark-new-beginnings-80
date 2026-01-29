import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2, CheckCircle, XCircle, AlertCircle, RefreshCw,
  Shield, Eye, EyeOff, Terminal, ExternalLink
} from "lucide-react";
import { toast } from "sonner";
import { useLauncherClient } from "@/hooks/useLauncherClient";

type ConnectionStatus = 'connected' | 'disconnected' | 'not_configured' | 'testing' | 'auth_required';

interface ConnectionResult {
  status: ConnectionStatus;
  error?: string;
  sessionsCount?: number;
}

export const DesktopAppSettings = () => {
  const { client, updateConfig, isConfigured } = useLauncherClient();

  const [apiUrl, setApiUrl] = useState<string>('http://localhost:3847');
  const [apiToken, setApiToken] = useState<string>('');
  const [showApiToken, setShowApiToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionResult>({ status: 'not_configured' });
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load saved config on mount
  useEffect(() => {
    const savedUrl = localStorage.getItem('launcher_api_url') || 'http://localhost:3847';
    const savedToken = localStorage.getItem('launcher_api_token') || '';

    setApiUrl(savedUrl);
    setApiToken(savedToken);

    if (savedUrl && savedToken) {
      testConnectionInternal(savedUrl, savedToken);
    } else {
      // Try auto-pairing if no config exists
      tryAutoPairing();
    }
  }, []);

  /**
   * Auto-pairing: Try to detect Desktop App on localhost and auto-configure
   */
  const tryAutoPairing = async () => {
    try {
      console.log('[DesktopApp] Attempting auto-pairing...');

      // Try to fetch pairing info from localhost
      const response = await fetch('http://localhost:3847/api/pairing/info', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();

        // Auto-configure with detected token
        setApiUrl('http://localhost:3847');
        setApiToken(data.token);

        // Save to localStorage
        localStorage.setItem('launcher_api_url', 'http://localhost:3847');
        localStorage.setItem('launcher_api_token', data.token);

        // Update client
        updateConfig('http://localhost:3847', data.token);

        // Test connection
        testConnectionInternal('http://localhost:3847', data.token);

        toast.success('Desktop App detected and configured automatically!');
        console.log('[DesktopApp] Auto-pairing successful:', data);
      }
    } catch (error) {
      // Silent fail - user can configure manually
      console.log('[DesktopApp] Auto-pairing failed (Desktop App not running?)');
    }
  };

  const testConnectionInternal = async (url: string, token: string) => {
    if (!url.trim()) {
      setConnectionStatus({ status: 'not_configured' });
      return;
    }

    setIsTesting(true);
    setConnectionStatus({ status: 'testing' });

    try {
      // Test connection by fetching sessions
      const response = await fetch(`${url}/api/sessions`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': token
        }
      });

      if (response.status === 401) {
        setConnectionStatus({
          status: 'auth_required',
          error: 'API Token non valido. Controlla il token in ~/.claude-launcher/api-config.json'
        });
        return;
      }

      if (!response.ok) {
        setConnectionStatus({
          status: 'disconnected',
          error: `HTTP ${response.status} - Il server ha risposto con un errore`
        });
        return;
      }

      const data = await response.json();
      setConnectionStatus({
        status: 'connected',
        sessionsCount: data.sessions?.length || 0
      });
    } catch (error) {
      let errorMessage = 'Connessione fallita - Verifica che Claude Launcher sia in esecuzione';

      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Claude Launcher non raggiungibile - Assicurati che sia in esecuzione sulla porta 3847';
        } else {
          errorMessage = error.message;
        }
      }

      setConnectionStatus({
        status: 'disconnected',
        error: errorMessage
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestConnection = () => {
    if (!apiUrl.trim()) {
      toast.error("Inserisci l'URL dell'API");
      return;
    }
    if (!apiToken.trim()) {
      toast.error("Inserisci l'API Token");
      return;
    }
    testConnectionInternal(apiUrl, apiToken);
  };

  const handleSave = () => {
    if (!apiUrl.trim() || !apiToken.trim()) {
      toast.error("Compila tutti i campi");
      return;
    }

    setIsSaving(true);

    try {
      // Save to localStorage and update client
      updateConfig(apiUrl, apiToken);

      toast.success("Configurazione salvata!");
      testConnectionInternal(apiUrl, apiToken);
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
            Connesso ({connectionStatus.sessionsCount} sessioni)
          </Badge>
        );
      case 'auth_required':
        return (
          <Badge variant="outline" className="border-orange-500 text-orange-600">
            <Shield className="h-3 w-3 mr-1" />
            Token non valido
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
    if (connectionStatus.status === 'auth_required') {
      return (
        <div className="mt-2 text-xs space-y-1">
          <p className="font-medium">Per risolvere:</p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
            <li>Apri il file di configurazione: <code className="bg-muted px-1 rounded">~/.claude-launcher/api-config.json</code></li>
            <li>Copia il valore del campo <code className="bg-muted px-1 rounded">token</code></li>
            <li>Incollalo nel campo "API Token" qui sopra</li>
            <li>Clicca "Save" e riprova la connessione</li>
          </ul>
        </div>
      );
    }

    if (connectionStatus.status !== 'disconnected' || !connectionStatus.error) return null;

    return (
      <div className="mt-2 text-xs space-y-1">
        <p className="font-medium">Suggerimenti:</p>
        <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
          <li>Verifica che Claude Launcher (HekaBrain Desktop App) sia in esecuzione</li>
          <li>La porta predefinita è <code className="bg-muted px-1 rounded">3847</code></li>
          <li>URL predefinito: <code className="bg-muted px-1 rounded">http://localhost:3847</code></li>
          <li>Assicurati che il token API sia corretto</li>
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* API URL Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Desktop App API URL
        </label>
        <Input
          type="url"
          placeholder="http://localhost:3847"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          URL dell'API Claude Launcher Desktop App (predefinito: http://localhost:3847)
        </p>
      </div>

      {/* API Token Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Shield className="h-4 w-4" />
          API Token
        </label>
        <div className="relative">
          <Input
            type={showApiToken ? "text" : "password"}
            placeholder="clp_..."
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            className="pr-10 font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            onClick={() => setShowApiToken(!showApiToken)}
          >
            {showApiToken ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Il token si trova in <code className="bg-muted px-1 rounded">~/.claude-launcher/api-config.json</code>
        </p>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Status:</span>
        {getStatusBadge()}
      </div>

      {/* Error message with suggestions */}
      {(connectionStatus.status === 'disconnected' || connectionStatus.status === 'auth_required') && connectionStatus.error && (
        <Alert variant={connectionStatus.status === 'auth_required' ? 'default' : 'destructive'}>
          {connectionStatus.status === 'auth_required' ? (
            <Shield className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
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
          disabled={isTesting || !apiUrl.trim() || !apiToken.trim()}
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
          disabled={isSaving || !apiUrl.trim() || !apiToken.trim()}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Save
        </Button>
        <Button
          variant="secondary"
          onClick={tryAutoPairing}
          disabled={isTesting}
        >
          🔄 Auto-Pair
        </Button>
      </div>

      {/* Info Alert */}
      <Alert>
        <Terminal className="h-4 w-4" />
        <AlertDescription>
          <strong>Come configurare:</strong>
          <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
            <li>Assicurati che Claude Launcher (HekaBrain Desktop App) sia in esecuzione</li>
            <li>Apri il file di configurazione:
              <div className="mt-1 p-2 bg-black text-green-400 rounded font-mono text-xs">
                Windows: %USERPROFILE%\.claude-launcher\api-config.json<br/>
                Mac/Linux: ~/.claude-launcher/api-config.json
              </div>
            </li>
            <li>Copia il valore del campo <code className="bg-muted px-1 rounded">token</code> (inizia con <code className="bg-muted px-1 rounded">clp_</code>)</li>
            <li>Incolla il token nel campo "API Token" qui sopra</li>
            <li>Clicca "Test Connection" per verificare</li>
            <li>Se connesso, clicca "Save"</li>
          </ol>
          <div className="mt-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded">
            <p className="text-sm font-medium text-blue-600">✨ Cosa puoi fare dopo la connessione:</p>
            <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside mt-1">
              <li>Leggere e cercare tutte le chat dei tuoi workspace</li>
              <li>Inviare messaggi alle sessioni attive</li>
              <li>Creare nuove sessioni da remoto</li>
              <li>Ricevere notifiche in tempo reale</li>
            </ul>
          </div>
        </AlertDescription>
      </Alert>

      {/* Quick Link to API Config */}
      <div className="flex items-center justify-center">
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            // Open file explorer to the config directory
            window.open('file:///' + (navigator.platform.includes('Win')
              ? 'C:/Users/%USERNAME%/.claude-launcher'
              : '~/.claude-launcher'
            ));
          }}
          className="text-xs"
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Apri cartella configurazione
        </Button>
      </div>
    </div>
  );
};
