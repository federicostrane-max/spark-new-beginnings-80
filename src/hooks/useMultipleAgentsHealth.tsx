import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AgentHealthStatus } from './useAgentHealth';

const POLL_INTERVAL = 30 * 1000; // 30 seconds
const AGENT_CHECK_DELAY = 3000; // 3 seconds between agents
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface AgentHealthCache {
  status: AgentHealthStatus;
  timestamp: number;
}

/**
 * Hook per monitorare lo stato di salute di MULTIPLI agenti
 * Usa polling sequenziale con delay per evitare timeout
 */
export const useMultipleAgentsHealth = (agentIds: string[]) => {
  const [healthStatus, setHealthStatus] = useState<Map<string, AgentHealthStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [cache, setCache] = useState<Map<string, AgentHealthCache>>(new Map());

  const checkSingleAgent = useCallback(async (agentId: string, useCache: boolean = true): Promise<AgentHealthStatus> => {
    // Check cache first
    if (useCache) {
      const cached = cache.get(agentId);
      if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        console.log(`[useMultipleAgentsHealth] Using cached health for agent ${agentId}`);
        return cached.status;
      }
    }

    try {
      const { data, error } = await supabase.functions.invoke('check-agent-health', {
        body: { agentId }
      });

      if (error) throw error;

      if (data?.success && data.health) {
        const status: AgentHealthStatus = {
          agentId: data.health.agentId,
          hasIssues: data.health.hasIssues,
          unsyncedCount: data.health.pendingDocuments + data.health.failedDocuments,
          errorCount: data.health.failedDocuments,
          warningCount: data.health.pendingDocuments,
          lastChecked: new Date()
        };

        // Update cache
        setCache(prev => new Map(prev).set(agentId, {
          status,
          timestamp: Date.now()
        }));

        return status;
      } else {
        throw new Error(data?.error || 'Failed to fetch health status');
      }
    } catch (err: any) {
      console.error(`[useMultipleAgentsHealth] Health check failed for agent ${agentId}:`, err);
      
      // Return cached data if available, even if stale
      const cached = cache.get(agentId);
      if (cached) {
        return cached.status;
      }
      
      // Return error status
      return {
        agentId,
        hasIssues: false, // Don't show false alarms
        unsyncedCount: 0,
        errorCount: 0,
        warningCount: 0,
        lastChecked: new Date()
      };
    }
  }, [cache]);

  const refreshHealth = useCallback(async () => {
    if (agentIds.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const newHealthMap = new Map<string, AgentHealthStatus>();

    try {
      // Process agents sequentially with delay to prevent overload
      for (let i = 0; i < agentIds.length; i++) {
        const agentId = agentIds[i];
        
        try {
          const status = await checkSingleAgent(agentId, true);
          newHealthMap.set(agentId, status);

          // Add delay between checks (except for last agent)
          if (i < agentIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, AGENT_CHECK_DELAY));
          }
        } catch (error) {
          console.error(`[useMultipleAgentsHealth] Failed to check agent ${agentId}:`, error);
          // Continue with next agent
          newHealthMap.set(agentId, {
            agentId,
            hasIssues: false,
            unsyncedCount: 0,
            errorCount: 0,
            warningCount: 0,
            lastChecked: new Date()
          });
        }
      }

      setHealthStatus(newHealthMap);
      console.log(`[useMultipleAgentsHealth] Health check completed for ${agentIds.length} agents`);
    } catch (error) {
      console.error('[useMultipleAgentsHealth] Failed to refresh health:', error);
    } finally {
      setIsLoading(false);
    }
  }, [agentIds.join(','), checkSingleAgent]);

  useEffect(() => {
    refreshHealth();

    const interval = setInterval(refreshHealth, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refreshHealth]);

  const getAgentStatus = useCallback((agentId: string): AgentHealthStatus | undefined => {
    return healthStatus.get(agentId);
  }, [healthStatus]);

  const hasAnyIssues = useCallback((): boolean => {
    return Array.from(healthStatus.values()).some(status => status.hasIssues);
  }, [healthStatus]);

  const getTotalIssueCount = useCallback((): number => {
    return Array.from(healthStatus.values()).reduce(
      (total, status) => total + (status.hasIssues ? 1 : 0),
      0
    );
  }, [healthStatus]);

  const getDetailedIssues = useCallback(() => {
    const problematicAgents = Array.from(healthStatus.values()).filter(status => status.hasIssues);
    const totalAgentsWithIssues = problematicAgents.length;
    const totalUnsyncedDocs = problematicAgents.reduce((sum, status) => sum + status.unsyncedCount, 0);
    
    return {
      totalAgentsWithIssues,
      totalUnsyncedDocs,
      problematicAgents
    };
  }, [healthStatus]);

  return {
    healthStatus,
    isLoading,
    refreshHealth,
    getAgentStatus,
    hasAnyIssues,
    getTotalIssueCount,
    getDetailedIssues
  };
};
