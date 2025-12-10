import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AgentHealthStatus } from './useAgentHealth';

const POLL_INTERVAL = 60 * 1000; // 60 seconds (increased from 30)
const AGENT_CHECK_DELAY = 2000; // 2 seconds between agents
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_CONCURRENT_CHECKS = 3; // Maximum concurrent health checks

interface AgentHealthCache {
  status: AgentHealthStatus;
  timestamp: number;
}

// Global cache shared across all hook instances
const globalCache = new Map<string, AgentHealthCache>();

// Global lock to prevent multiple simultaneous refresh cycles
let isRefreshInProgress = false;
let lastRefreshTime = 0;
const MIN_REFRESH_INTERVAL = 10000; // 10 seconds minimum between full refreshes

/**
 * Hook per monitorare lo stato di salute di MULTIPLI agenti
 * Usa polling sequenziale con delay e global cache per evitare overload
 */
export const useMultipleAgentsHealth = (agentIds: string[]) => {
  const [healthStatus, setHealthStatus] = useState<Map<string, AgentHealthStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const refreshingRef = useRef(false);

  const checkSingleAgent = useCallback(async (agentId: string, useCache: boolean = true): Promise<AgentHealthStatus> => {
    // Check global cache first
    if (useCache) {
      const cached = globalCache.get(agentId);
      if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
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

        // Update global cache
        globalCache.set(agentId, {
          status,
          timestamp: Date.now()
        });

        return status;
      } else {
        throw new Error(data?.error || 'Failed to fetch health status');
      }
    } catch (err: any) {
      console.error(`[useMultipleAgentsHealth] Health check failed for agent ${agentId}:`, err.message);
      
      // Return cached data if available, even if stale
      const cached = globalCache.get(agentId);
      if (cached) {
        return cached.status;
      }
      
      // Return empty status
      return {
        agentId,
        hasIssues: false,
        unsyncedCount: 0,
        errorCount: 0,
        warningCount: 0,
        lastChecked: new Date()
      };
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    // Prevent concurrent refresh cycles globally
    if (isRefreshInProgress) {
      console.log('[useMultipleAgentsHealth] Refresh already in progress, skipping');
      return;
    }

    // Prevent too frequent refreshes
    const timeSinceLastRefresh = Date.now() - lastRefreshTime;
    if (timeSinceLastRefresh < MIN_REFRESH_INTERVAL) {
      console.log(`[useMultipleAgentsHealth] Too soon since last refresh (${timeSinceLastRefresh}ms), skipping`);
      return;
    }

    if (agentIds.length === 0) {
      setIsLoading(false);
      return;
    }

    if (refreshingRef.current) return;
    refreshingRef.current = true;
    isRefreshInProgress = true;
    lastRefreshTime = Date.now();

    setIsLoading(true);
    const newHealthMap = new Map<string, AgentHealthStatus>();

    try {
      // First, populate from cache
      for (const agentId of agentIds) {
        const cached = globalCache.get(agentId);
        if (cached) {
          newHealthMap.set(agentId, cached.status);
        }
      }

      // Find agents that need fresh data
      const staleAgentIds = agentIds.filter(agentId => {
        const cached = globalCache.get(agentId);
        return !cached || (Date.now() - cached.timestamp) >= CACHE_DURATION;
      });

      // Process stale agents in small batches with delay
      for (let i = 0; i < staleAgentIds.length; i += MAX_CONCURRENT_CHECKS) {
        if (!mountedRef.current) break;

        const batch = staleAgentIds.slice(i, i + MAX_CONCURRENT_CHECKS);
        
        // Process batch concurrently
        const results = await Promise.allSettled(
          batch.map(agentId => checkSingleAgent(agentId, false))
        );

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            newHealthMap.set(batch[index], result.value);
          }
        });

        // Delay between batches (except for last batch)
        if (i + MAX_CONCURRENT_CHECKS < staleAgentIds.length) {
          await new Promise(resolve => setTimeout(resolve, AGENT_CHECK_DELAY));
        }
      }

      if (mountedRef.current) {
        setHealthStatus(newHealthMap);
        console.log(`[useMultipleAgentsHealth] Health check completed for ${agentIds.length} agents (${staleAgentIds.length} refreshed)`);
      }
    } catch (error) {
      console.error('[useMultipleAgentsHealth] Failed to refresh health:', error);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
      refreshingRef.current = false;
      isRefreshInProgress = false;
    }
  }, [agentIds.join(','), checkSingleAgent]);

  useEffect(() => {
    mountedRef.current = true;

    // Initial refresh with random delay to spread load
    const initialDelay = Math.random() * 3000;
    const initialTimeout = setTimeout(() => {
      if (mountedRef.current) {
        refreshHealth();
      }
    }, initialDelay);

    // Set up polling with jitter
    const interval = setInterval(() => {
      if (mountedRef.current) {
        refreshHealth();
      }
    }, POLL_INTERVAL + Math.random() * 10000); // Add up to 10s jitter

    return () => {
      mountedRef.current = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
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
