import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save, Zap, Brain, ListChecks, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
}

interface LuxModeConfigEntry {
  lux_mode: string;
  agent_id: string | null;
}

export const LuxModeConfig = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [config, setConfig] = useState<Record<string, string | null>>({
    actor: null,
    thinker: null,
    tasker: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch agents and current config
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch active agents
        const { data: agentsData, error: agentsError } = await supabase
          .from('agents')
          .select('id, name, slug, description')
          .eq('active', true)
          .order('name');

        if (agentsError) throw agentsError;
        setAgents(agentsData || []);

        // Fetch current config
        const { data: configData, error: configError } = await supabase
          .from('lux_mode_config')
          .select('lux_mode, agent_id');

        if (configError) throw configError;

        const configMap: Record<string, string | null> = {
          actor: null,
          thinker: null,
          tasker: null
        };
        
        (configData || []).forEach((entry: LuxModeConfigEntry) => {
          configMap[entry.lux_mode] = entry.agent_id;
        });

        setConfig(configMap);
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Errore nel caricamento della configurazione');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update each mode's configuration
      for (const mode of ['actor', 'thinker', 'tasker']) {
        const { error } = await supabase
          .from('lux_mode_config')
          .update({ 
            agent_id: config[mode],
            updated_at: new Date().toISOString()
          })
          .eq('lux_mode', mode);

        if (error) throw error;
      }

      toast.success('Configurazione salvata con successo!');
    } catch (error) {
      console.error('Error saving config:', error);
      toast.error('Errore nel salvataggio della configurazione');
    } finally {
      setSaving(false);
    }
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return 'Non configurato';
    const agent = agents.find(a => a.id === agentId);
    return agent?.name || 'Agente sconosciuto';
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Configurazione Agenti Lux
        </CardTitle>
        <CardDescription>
          Seleziona quale agente riformula le richieste per ciascuna modalità di automazione browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Actor Mode */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            <label className="font-medium">Actor Mode (Task Semplici)</label>
          </div>
          <p className="text-sm text-muted-foreground">
            Max 20 steps • Model: lux-actor-1 • Per azioni dirette e immediate
          </p>
          <Select 
            value={config.actor || ''} 
            onValueChange={(value) => setConfig(prev => ({ ...prev, actor: value || null }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleziona agente..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Thinker Mode */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-500" />
            <label className="font-medium">Thinker Mode (Task Complessi)</label>
          </div>
          <p className="text-sm text-muted-foreground">
            Max 100 steps • Model: lux-thinker-1 • Per task che richiedono ragionamento autonomo
          </p>
          <Select 
            value={config.thinker || ''} 
            onValueChange={(value) => setConfig(prev => ({ ...prev, thinker: value || null }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleziona agente..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tasker Mode */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-blue-500" />
            <label className="font-medium">Tasker Mode (Con Step Sequenziali)</label>
          </div>
          <p className="text-sm text-muted-foreground">
            Max 60 steps • Model: lux-actor-1 • Per task decomposte in step controllabili
          </p>
          <Select 
            value={config.tasker || ''} 
            onValueChange={(value) => setConfig(prev => ({ ...prev, tasker: value || null }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleziona agente..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Save Button */}
        <Button 
          onClick={handleSave} 
          disabled={saving}
          className="w-full"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvataggio...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Salva Configurazione
            </>
          )}
        </Button>

        {/* Info Alert */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Gli agenti Lux possono essere modificati dalla lista agenti principale. 
            Puoi cambiare il loro system prompt e knowledge base come qualsiasi altro agente.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
