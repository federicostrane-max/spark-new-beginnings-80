import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Server, CheckCircle, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { toolServerClient } from "@/lib/tool-server";

type ConnectionStatus = 'connected' | 'disconnected' | 'not_configured' | 'testing';

interface ConnectionResult {
  status: ConnectionStatus;
  version?: string;
  error?: string;
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
    setIsTesting(true);
    setConnectionStatus({ status: 'testing' });
    
    try {
      const response = await fetch(`${testUrl}/status`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        setConnectionStatus({ 
          status: 'disconnected', 
          error: `HTTP ${response.status}` 
        });
        return;
      }
      
      const data = await response.json();
      setConnectionStatus({ 
        status: 'connected', 
        version: data.version 
      });
    } catch (error) {
      setConnectionStatus({ 
        status: 'disconnected', 
        error: error instanceof Error ? error.message : 'Connection failed' 
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestConnection = () => {
    if (!url.trim()) {
      toast.error("Inserisci un URL valido");
      return;
    }
    testConnectionInternal(url.trim());
  };

  const handleSave = () => {
    setIsSaving(true);
    
    try {
      const trimmedUrl = url.trim();
      toolServerClient.updateBaseUrl(trimmedUrl);
      toast.success("URL Tool Server salvato!");
      
      // Auto-test after save
      if (trimmedUrl) {
        testConnectionInternal(trimmedUrl);
      } else {
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
            Connected {connectionStatus.version ? `(${connectionStatus.version})` : ''}
          </Badge>
        );
      case 'disconnected':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Disconnected
          </Badge>
        );
      case 'testing':
        return (
          <Badge variant="secondary">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Testing...
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <AlertCircle className="h-3 w-3 mr-1" />
            Not configured
          </Badge>
        );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Tool Server Configuration
        </CardTitle>
        <CardDescription>
          Configura l'URL del Tool Server per l'automazione browser locale
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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

        {/* Error message */}
        {connectionStatus.status === 'disconnected' && connectionStatus.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {connectionStatus.error}
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
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Come configurare:</strong>
            <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
              <li>Avvia Tool Server sul tuo PC (genera URL ngrok automaticamente)</li>
              <li>Copia l'URL ngrok dal terminale (es: https://xxx.ngrok-free.app)</li>
              <li>Incolla qui e clicca "Test Connection"</li>
              <li>Se connesso, clicca "Save"</li>
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              ⚠️ L'URL ngrok cambia ogni riavvio del Tool Server
            </p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
