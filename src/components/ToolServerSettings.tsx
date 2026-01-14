import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, Server, CheckCircle, XCircle, AlertCircle, RefreshCw,
  Link2, Unlink, Copy, Monitor, Clock
} from "lucide-react";
import { toast } from "sonner";
import { toolServerClient, normalizeToolServerUrl } from "@/lib/tool-server";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type ConnectionStatus = 'connected' | 'disconnected' | 'not_configured' | 'testing';

interface ConnectionResult {
  status: ConnectionStatus;
  version?: string;
  error?: string;
  urlUsed?: string;
}

interface PairingConfig {
  user_id: string;
  ngrok_url: string | null;
  device_name: string;
  paired_at: string;
  updated_at: string;
}

export const ToolServerSettings = () => {
  const { user } = useAuth();
  const [url, setUrl] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionResult>({ status: 'not_configured' });
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Pairing state
  const [isPairingDialogOpen, setIsPairingDialogOpen] = useState(false);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiry, setPairingExpiry] = useState<number>(0);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [pairedConfig, setPairedConfig] = useState<PairingConfig | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Load saved URL and check pairing status on mount
  useEffect(() => {
    const savedUrl = localStorage.getItem('toolServerUrl') || '';
    setUrl(savedUrl);

    if (savedUrl) {
      testConnectionInternal(savedUrl);
    }

    // Check if already paired
    if (user) {
      checkPairingStatus();
    }
  }, [user]);

  // Realtime subscription for tool_server_config
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('tool_server_config_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tool_server_config',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('[ToolServer] Realtime update:', payload);

          if (payload.eventType === 'DELETE') {
            // Disconnected
            setPairedConfig(null);
            toast.info("Tool Server disconnesso");
          } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newConfig = payload.new as PairingConfig;
            setPairedConfig(newConfig);

            // Auto-update URL if changed
            if (newConfig.ngrok_url && newConfig.ngrok_url !== url) {
              setUrl(newConfig.ngrok_url);
              toolServerClient.updateBaseUrl(newConfig.ngrok_url);
              testConnectionInternal(newConfig.ngrok_url);

              if (isPairingDialogOpen) {
                setIsPairingDialogOpen(false);
                toast.success("Tool Server collegato con successo!");
              } else {
                toast.success("URL Tool Server aggiornato automaticamente");
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user, url, isPairingDialogOpen]);

  // Countdown timer for pairing token
  useEffect(() => {
    if (pairingExpiry <= 0) return;

    const timer = setInterval(() => {
      setPairingExpiry(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setPairingToken(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [pairingExpiry]);

  const checkPairingStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('tool-server-pair', {
        body: { action: 'get_config' }
      });

      if (!error && data?.paired && data?.config) {
        setPairedConfig(data.config);

        // Auto-sync URL if we have one from pairing
        if (data.config.ngrok_url) {
          setUrl(data.config.ngrok_url);
          toolServerClient.updateBaseUrl(data.config.ngrok_url);
          testConnectionInternal(data.config.ngrok_url);
        }
      }
    } catch (err) {
      console.error('[ToolServer] Failed to check pairing status:', err);
    }
  };

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

  const handleGeneratePairingToken = async () => {
    if (!user) {
      toast.error("Devi essere loggato per collegare il Tool Server");
      return;
    }

    setIsGeneratingToken(true);
    try {
      const { data, error } = await supabase.functions.invoke('tool-server-pair', {
        body: { action: 'generate' }
      });

      if (error) throw error;

      setPairingToken(data.token);
      setPairingExpiry(data.expires_in_seconds);
      setIsPairingDialogOpen(true);
    } catch (err) {
      console.error('[ToolServer] Failed to generate pairing token:', err);
      toast.error("Errore nella generazione del codice");
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;

    setIsDisconnecting(true);
    try {
      const { error } = await supabase.functions.invoke('tool-server-pair', {
        body: { action: 'disconnect' }
      });

      if (error) throw error;

      setPairedConfig(null);
      toast.success("Tool Server disconnesso");
    } catch (err) {
      console.error('[ToolServer] Failed to disconnect:', err);
      toast.error("Errore nella disconnessione");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleCopyToken = () => {
    if (pairingToken) {
      navigator.clipboard.writeText(pairingToken);
      toast.success("Codice copiato!");
    }
  };

  const handleCopyCommand = () => {
    if (pairingToken) {
      navigator.clipboard.writeText(`python tool_server.py --pair ${pairingToken}`);
      toast.success("Comando copiato!");
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
      toolServerClient.updateBaseUrl(normalized);

      if (normalized) {
        toast.success("URL Tool Server salvato!");
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

  const formatExpiryTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'adesso';
    if (diffMins < 60) return `${diffMins} min fa`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} ore fa`;
    return date.toLocaleDateString();
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
      {/* Pairing Section (for logged in users) */}
      {user && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Collegamento Automatico</label>
            {pairedConfig && (
              <Badge variant="outline" className="border-blue-500 text-blue-600">
                <Monitor className="h-3 w-3 mr-1" />
                {pairedConfig.device_name} - Auto-sync attivo
              </Badge>
            )}
          </div>

          {pairedConfig ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Ultimo aggiornamento: {formatRelativeTime(pairedConfig.updated_at)}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="text-red-600 hover:text-red-700"
              >
                {isDisconnecting ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Unlink className="h-4 w-4 mr-1" />
                )}
                Disconnetti
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleGeneratePairingToken}
              disabled={isGeneratingToken}
              className="w-full"
            >
              {isGeneratingToken ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              Collega Tool Server
            </Button>
          )}
        </div>
      )}

      {/* Separator */}
      {user && <div className="border-t border-border" />}

      {/* Manual URL Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {user ? "URL Manuale (opzionale)" : "Tool Server URL"}
        </label>
        <Input
          type="url"
          placeholder="https://xxx.ngrok-free.app"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {user
            ? "Usa il collegamento automatico sopra, oppure inserisci l'URL manualmente"
            : "Inserisci l'URL ngrok del tuo Tool Server locale"}
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
          {user ? (
            <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
              <li>Avvia Tool Server sul tuo PC</li>
              <li>Clicca "Collega Tool Server" qui sopra</li>
              <li>Copia il codice ed eseguilo nel terminale</li>
              <li>L'URL si aggiornerà automaticamente!</li>
            </ol>
          ) : (
            <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
              <li>Avvia Tool Server sul tuo PC (genera URL ngrok automaticamente)</li>
              <li>Copia l'URL ngrok dal terminale (es: <code className="bg-muted px-1 rounded">https://xxx.ngrok-free.app</code>)</li>
              <li>Incolla qui e clicca "Test Connection"</li>
              <li>Se connesso, clicca "Save"</li>
            </ol>
          )}
          {!user && (
            <p className="mt-2 text-xs text-muted-foreground">
              Effettua il login per abilitare il collegamento automatico
            </p>
          )}
        </AlertDescription>
      </Alert>

      {/* Pairing Dialog */}
      <Dialog open={isPairingDialogOpen} onOpenChange={setIsPairingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Collega Tool Server
            </DialogTitle>
            <DialogDescription>
              Esegui questo comando nel terminale dove hai avviato il Tool Server
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Pairing Code */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Codice di Pairing:</label>
              <div
                className="flex items-center justify-center p-4 bg-muted rounded-lg cursor-pointer hover:bg-muted/80 transition-colors"
                onClick={handleCopyToken}
              >
                <span className="text-3xl font-mono font-bold tracking-[0.5em]">
                  {pairingToken || '------'}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyToken}
                className="w-full"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copia Codice
              </Button>
            </div>

            {/* Command */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Esegui nel terminale:</label>
              <div
                className="p-3 bg-black text-green-400 rounded-lg font-mono text-sm cursor-pointer hover:bg-gray-900 transition-colors"
                onClick={handleCopyCommand}
              >
                python tool_server.py --pair {pairingToken || 'XXXXXX'}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyCommand}
                className="w-full"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copia Comando
              </Button>
            </div>

            {/* Countdown */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Valido per: <span className="font-mono font-bold">{formatExpiryTime(pairingExpiry)}</span>
            </div>

            {/* Waiting indicator */}
            <div className="flex items-center justify-center gap-2 text-sm text-blue-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              In attesa di connessione...
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
