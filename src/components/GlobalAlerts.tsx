import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";
import { usePoolDocumentsHealth } from "@/hooks/useAgentHealth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

interface GlobalAlertsProps {
  hasAgentIssues?: boolean;
}

export const GlobalAlerts = ({ hasAgentIssues = false }: GlobalAlertsProps) => {
  const navigate = useNavigate();
  const poolHealth = usePoolDocumentsHealth();
  const [isSyncing, setIsSyncing] = useState(false);

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

      toast.info(`Avvio sincronizzazione di ${agents.length} agenti in parallelo...`);

      // Helper function to sync a single agent with timeout
      const syncAgentWithTimeout = async (agent: { id: string; name: string }, index: number) => {
        const TIMEOUT_MS = 120000; // 2 minutes timeout per agent
        
        toast.info(`Sincronizzando ${agent.name} (${index + 1}/${agents.length})...`);
        
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout - operazione troppo lenta')), TIMEOUT_MS)
        );
        
        const syncPromise = supabase.functions.invoke('check-and-sync-all', {
          body: { agentId: agent.id, autoFix: true }
        });
        
        return Promise.race([syncPromise, timeoutPromise]);
      };

      // Sync all agents in parallel
      const results = await Promise.allSettled(
        agents.map((agent, index) => syncAgentWithTimeout(agent, index))
      );

      // Process results
      let totalFixed = 0;
      const errors: string[] = [];
      const successful: string[] = [];

      results.forEach((result, index) => {
        const agent = agents[index];
        
        if (result.status === 'fulfilled') {
          const { data, error } = result.value;
          
          if (error) {
            errors.push(`${agent.name}: ${error.message}`);
          } else if (data?.fixedCount > 0) {
            totalFixed += data.fixedCount;
            successful.push(agent.name);
          }
        } else {
          errors.push(`${agent.name}: ${result.reason?.message || 'Errore sconosciuto'}`);
        }
      });

      // Show results
      if (errors.length > 0 && successful.length === 0) {
        toast.error(`Sincronizzazione fallita per tutti gli agenti: ${errors.join(', ')}`);
      } else if (errors.length > 0) {
        toast.warning(`Sincronizzati ${successful.length}/${agents.length} agenti. Errori: ${errors.join(', ')}`);
      } else if (totalFixed > 0) {
        toast.success(`✅ Sincronizzazione completata: ${totalFixed} documenti sincronizzati su ${agents.length} agenti`);
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

  // Mostra alert se ci sono problemi nel pool O problemi negli agenti
  if (!poolHealth.hasIssues && !hasAgentIssues) {
    return null;
  }

  const issueDetails = [
    poolHealth.stuckCount > 0 && `${poolHealth.stuckCount} bloccati`,
    poolHealth.errorCount > 0 && `${poolHealth.errorCount} con errori`,
    poolHealth.validatingCount > 0 && `${poolHealth.validatingCount} bloccati in validazione`,
    hasAgentIssues && 'Documenti agenti non sincronizzati'
  ].filter(Boolean).join(' • ');

  const totalIssueCount = poolHealth.issueCount + (hasAgentIssues ? 1 : 0);
  const issueLabel = poolHealth.hasIssues ? 'pool documenti' : 'agenti';

  return (
    <Alert variant="destructive" className="mx-4 mt-4 border-2">
      <AlertTriangle className="h-5 w-5" />
      <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <span className="font-semibold">
            {totalIssueCount} {totalIssueCount === 1 ? 'problema' : 'problemi'} {issueLabel}
          </span>
          <p className="text-sm mt-1 opacity-90">
            {issueDetails}
          </p>
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
  );
};
