import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Database, RefreshCw, Eye, X } from "lucide-react";
import { usePoolDocumentsHealth } from "@/hooks/useAgentHealth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { logger } from "@/lib/logger";

interface GlobalAlertsProps {
  hasAgentIssues?: boolean;
}

interface AgentAlert {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  action_url: string | null;
  created_at: string;
}

export const GlobalAlerts = ({ hasAgentIssues = false }: GlobalAlertsProps) => {
  const navigate = useNavigate();
  const poolHealth = usePoolDocumentsHealth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [agentAlerts, setAgentAlerts] = useState<AgentAlert[]>([]);

  // Fetch agent alerts
  useEffect(() => {
    const fetchAlerts = async () => {
      const { data } = await supabase
        .from('agent_alerts')
        .select('*')
        .eq('is_read', false)
        .eq('dismissed', false)
        .order('created_at', { ascending: false })
        .limit(3);
      
      setAgentAlerts((data as any) || []);
    };
    
    fetchAlerts();
    
    // Subscribe to new alerts
    const channel = supabase
      .channel('agent_alerts_global')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_alerts'
        },
        (payload) => {
          setAgentAlerts(prev => [payload.new as AgentAlert, ...prev].slice(0, 3));
        }
      )
      .subscribe();
    
    return () => {
      channel.unsubscribe();
    };
  }, []);

  const handleDismissAlert = async (alertId: string) => {
    await supabase
      .from('agent_alerts')
      .update({ dismissed: true, dismissed_at: new Date().toISOString() })
      .eq('id', alertId);
    
    setAgentAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  const handleMarkAsRead = async (alertId: string, actionUrl?: string | null) => {
    await supabase
      .from('agent_alerts')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', alertId);
    
    setAgentAlerts(prev => prev.filter(a => a.id !== alertId));
    
    if (actionUrl) {
      navigate(actionUrl);
    }
  };

  const getSeverityVariant = (severity: string): "default" | "destructive" => {
    switch (severity) {
      case 'error':
      case 'critical':
        return 'destructive';
      case 'warning':
      case 'info':
      default:
        return 'default';
    }
  };

  const handleSyncAllAgents = async () => {
    try {
      setIsSyncing(true);
      
      // Get all agents
      const { data: agents, error: agentsError } = await supabase
        .from('agents')
        .select('id, name')
        .eq('active', true);

      if (agentsError) throw agentsError;

      if (!agents || agents.length === 0) {
        toast.info("Nessun agente attivo da sincronizzare");
        return;
      }

      toast.info(`Avvio sincronizzazione di ${agents.length} agenti...`);

      // Helper function to sync a single agent with timeout
      const syncAgentWithTimeout = async (agent: { id: string; name: string }, index: number) => {
        const TIMEOUT_MS = 120000; // 2 minutes timeout per agent
        
        console.log(`Sincronizzando ${agent.name} (${index + 1}/${agents.length})...`);
        
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout - operazione troppo lenta')), TIMEOUT_MS)
        );
        
        const session = await supabase.auth.getSession();
        if (!session.data.session) throw new Error('Sessione non valida');

        const syncPromise = fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-and-sync-all`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.data.session.access_token}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ agentId: agent.id, autoFix: true })
          }
        ).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          console.log(`✓ ${agent.name} sincronizzato:`, data);
          return { data, error: null };
        });
        
        return Promise.race([syncPromise, timeoutPromise]);
      };

      // Sync all agents in parallel
      const results = await Promise.allSettled(
        agents.map((agent, index) => syncAgentWithTimeout(agent, index))
      );

      // Process results
      let totalDocsSynced = 0;
      const errors: string[] = [];
      const successful: string[] = [];

      results.forEach((result, index) => {
        const agent = agents[index];
        
        if (result.status === 'fulfilled') {
          const { data, error } = result.value;
          
          if (error) {
            errors.push(`${agent.name}: ${error.message}`);
          } else {
            // Conta documenti sincronizzati (missing prima del fix)
            const syncedCount = data?.statuses?.filter((s: any) => s.status === 'missing').length || 0;
            if (syncedCount > 0) {
              totalDocsSynced += syncedCount;
              successful.push(`${agent.name} (${syncedCount})`);
            }
          }
        } else {
          errors.push(`${agent.name}: ${result.reason?.message || 'Errore sconosciuto'}`);
        }
      });

      // Clean all client-side logs before showing results
      logger.clearAllLogs();

      // Show results
      if (errors.length > 0 && successful.length === 0) {
        toast.error(`Sincronizzazione fallita: ${errors.slice(0, 2).join(', ')}${errors.length > 2 ? `... +${errors.length - 2}` : ''}`);
      } else if (totalDocsSynced > 0) {
        toast.success(`✅ Sincronizzati ${totalDocsSynced} documenti su ${successful.length} agenti`);
      } else {
        toast.info("✓ Tutti gli agenti sono già sincronizzati");
      }

      // Refresh page after sync
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error: any) {
      console.error("Error syncing all agents:", error);
      toast.error(`Errore nella sincronizzazione: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // NON mostrare alert se non ci sono problemi reali
  if (!poolHealth.hasIssues && !hasAgentIssues) {
    return null;
  }

  // NON mostrare se issueCount è 0 (fix bug "0 problemi")
  if (poolHealth.issueCount === 0 && !hasAgentIssues) {
    return null;
  }

  const issueDetails = [];
  
  // Pool issues
  if (poolHealth.errorCount > 0) {
    issueDetails.push(`${poolHealth.errorCount} documenti pool con errori`);
  }
  if (poolHealth.validatingCount > 0) {
    issueDetails.push(`${poolHealth.validatingCount} documenti pool in validazione da troppo tempo`);
  }

  const totalIssueCount = poolHealth.issueCount;

  // Render both agent alerts and pool alerts
  return (
    <div className="space-y-4 mx-4 mt-4">
      {/* Agent Operation Alerts */}
      {agentAlerts.map((alert) => (
        <Alert key={alert.id} variant={getSeverityVariant(alert.severity)} className="border-2 shadow-lg">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="flex items-center justify-between">
            <span>{alert.title}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => handleDismissAlert(alert.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          </AlertTitle>
          <AlertDescription className="space-y-2 mt-2">
            <p className="text-sm">{alert.message}</p>
            <div className="flex gap-2">
              {alert.action_url && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleMarkAsRead(alert.id, alert.action_url)}
                  className="bg-background hover:bg-background/90"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Visualizza
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDismissAlert(alert.id)}
              >
                Ignora
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ))}

      {/* Pool Health Alert */}
      {(poolHealth.hasIssues || hasAgentIssues) && poolHealth.issueCount > 0 && (
        <Alert variant="destructive" className="border-2">
          <AlertTriangle className="h-5 w-5" />
          <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <span className="font-semibold">
            {totalIssueCount > 0 
              ? `${totalIssueCount} ${totalIssueCount === 1 ? 'problema' : 'problemi'} nel pool documenti`
              : 'Problemi di sincronizzazione agenti'
            }
          </span>
          {issueDetails.length > 0 && (
            <p className="text-sm mt-1 opacity-90">
              {issueDetails.join(' • ')}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleSyncAllAgents}
            disabled={isSyncing}
            className="bg-background hover:bg-background/90"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
            Sincronizza Tutti
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate("/documents")}
            className="bg-background hover:bg-background/90"
          >
            <Database className="h-4 w-4 mr-2" />
            Pool Documenti
          </Button>
        </div>
      </AlertDescription>
    </Alert>
      )}
    </div>
  );
};
