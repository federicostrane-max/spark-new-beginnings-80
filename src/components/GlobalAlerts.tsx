import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Database, RefreshCw } from "lucide-react";
import { usePoolDocumentsHealth } from "@/hooks/useAgentHealth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

export const GlobalAlerts = () => {
  const navigate = useNavigate();
  const poolHealth = usePoolDocumentsHealth();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncAllAgents = async () => {
    try {
      setIsSyncing(true);
      toast.info("Sincronizzazione di tutti gli agenti in corso...");

      // Get all agents
      const { data: agents, error: agentsError } = await supabase
        .from('agents')
        .select('id, name')
        .eq('active', true);

      if (agentsError) throw agentsError;

      let totalFixed = 0;
      const errors: string[] = [];

      // Sync each agent
      for (const agent of agents || []) {
        try {
          const { data, error } = await supabase.functions.invoke('check-and-sync-all', {
            body: { agentId: agent.id, autoFix: true }
          });

          if (error) throw error;
          
          if (data?.fixedCount > 0) {
            totalFixed += data.fixedCount;
          }
        } catch (err: any) {
          console.error(`Error syncing agent ${agent.name}:`, err);
          errors.push(`${agent.name}: ${err.message}`);
        }
      }

      if (errors.length > 0) {
        toast.error(`Alcuni agenti non sono stati sincronizzati: ${errors.join(', ')}`);
      } else if (totalFixed > 0) {
        toast.success(`Sincronizzazione completata: ${totalFixed} documenti sincronizzati`);
      } else {
        toast.info("Nessun documento da sincronizzare");
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

  if (!poolHealth.hasIssues) {
    return null;
  }

  const issueDetails = [
    poolHealth.stuckCount > 0 && `${poolHealth.stuckCount} bloccati`,
    poolHealth.errorCount > 0 && `${poolHealth.errorCount} con errori`,
    poolHealth.validatingCount > 0 && `${poolHealth.validatingCount} bloccati in validazione`
  ].filter(Boolean).join(' • ');

  return (
    <Alert variant="destructive" className="mx-4 mt-4 border-2">
      <AlertTriangle className="h-5 w-5" />
      <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <span className="font-semibold">
            {poolHealth.issueCount} {poolHealth.issueCount === 1 ? 'problema' : 'problemi'} nel pool documenti
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
