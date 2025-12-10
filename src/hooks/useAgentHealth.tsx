import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface DocumentStatus {
  documentId: string;
  fileName: string;
  chunkCount: number;
  syncStatus: 'pending' | 'completed' | 'failed';
}

interface AgentHealth {
  agentId: string;
  totalDocuments: number;
  syncedDocuments: number;
  pendingDocuments: number;
  failedDocuments: number;
  hasIssues: boolean;
  documents: DocumentStatus[];
  lastChecked: Date;
  isStale: boolean;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL = 60 * 1000; // 60 seconds (increased from 30)
const REQUEST_TIMEOUT = 10000; // 10 seconds

export interface AgentHealthStatus {
  agentId: string;
  hasIssues: boolean;
  unsyncedCount: number;
  errorCount: number;
  warningCount: number;
  lastChecked: Date;
}

// Global request deduplication - prevents multiple simultaneous requests for same agent
const pendingRequests = new Map<string, Promise<AgentHealth | null>>();
const globalCache = new Map<string, { health: AgentHealth; timestamp: number }>();

// Throttle function to prevent rapid successive calls
const throttledAgents = new Set<string>();
const THROTTLE_DELAY = 5000; // 5 seconds minimum between calls for same agent

async function fetchAgentHealth(agentId: string): Promise<AgentHealth | null> {
  // Check if request is already in flight for this agent
  const pending = pendingRequests.get(agentId);
  if (pending) {
    console.log(`[useAgentHealth] Reusing pending request for agent ${agentId}`);
    return pending;
  }

  // Check throttle
  if (throttledAgents.has(agentId)) {
    const cached = globalCache.get(agentId);
    if (cached) {
      console.log(`[useAgentHealth] Throttled - using cache for agent ${agentId}`);
      return cached.health;
    }
    return null;
  }

  // Check global cache
  const cached = globalCache.get(agentId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    console.log(`[useAgentHealth] Using global cache for agent ${agentId}`);
    return cached.health;
  }

  // Create new request
  const requestPromise = (async () => {
    try {
      // Apply throttle
      throttledAgents.add(agentId);
      setTimeout(() => throttledAgents.delete(agentId), THROTTLE_DELAY);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const { data, error } = await supabase.functions.invoke('check-agent-health', {
        body: { agentId }
      });

      clearTimeout(timeoutId);

      if (error) throw error;

      if (data?.success && data.health) {
        const newHealth: AgentHealth = {
          ...data.health,
          lastChecked: new Date(),
          isStale: false
        };
        
        // Update global cache
        globalCache.set(agentId, { health: newHealth, timestamp: Date.now() });
        
        return newHealth;
      } else if (data?.health?.degraded) {
        // Handle degraded response gracefully
        const degradedHealth: AgentHealth = {
          agentId,
          totalDocuments: 0,
          syncedDocuments: 0,
          pendingDocuments: 0,
          failedDocuments: 0,
          hasIssues: false,
          documents: [],
          lastChecked: new Date(),
          isStale: true
        };
        return degradedHealth;
      } else {
        throw new Error(data?.error || 'Failed to fetch health status');
      }
    } catch (err: any) {
      console.error(`[useAgentHealth] Health check failed for ${agentId}:`, err.message);
      
      // Return cached data if available
      const cached = globalCache.get(agentId);
      if (cached) {
        return { ...cached.health, isStale: true };
      }
      
      // Return empty health instead of null to prevent UI errors
      return {
        agentId,
        totalDocuments: 0,
        syncedDocuments: 0,
        pendingDocuments: 0,
        failedDocuments: 0,
        hasIssues: false,
        documents: [],
        lastChecked: new Date(),
        isStale: true
      };
    } finally {
      // Clean up pending request
      pendingRequests.delete(agentId);
    }
  })();

  pendingRequests.set(agentId, requestPromise);
  return requestPromise;
}

/**
 * Hook per monitorare lo stato di salute di UN SINGOLO agente
 * Usa cache globale e request deduplication per evitare overload
 */
export const useAgentHealth = (agentId?: string) => {
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const checkHealth = useCallback(async (agentIdToCheck: string, useCache: boolean = true): Promise<AgentHealth | null> => {
    if (!mountedRef.current) return null;
    
    // Check local state cache first
    if (useCache && health && health.agentId === agentIdToCheck) {
      const age = Date.now() - health.lastChecked.getTime();
      if (age < CACHE_DURATION) {
        return health;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      const newHealth = await fetchAgentHealth(agentIdToCheck);
      
      if (mountedRef.current && newHealth) {
        setHealth(newHealth);
      }
      
      return newHealth;
    } catch (err: any) {
      if (mountedRef.current) {
        setError(err.message || 'Failed to check health');
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [health]);

  // Auto-poll when agentId is provided
  useEffect(() => {
    mountedRef.current = true;
    
    if (!agentId) return;

    // Initial check with small random delay to spread requests
    const initialDelay = Math.random() * 2000;
    const initialTimeout = setTimeout(() => {
      if (mountedRef.current) {
        checkHealth(agentId, true);
      }
    }, initialDelay);

    // Set up polling with jitter
    const interval = setInterval(() => {
      if (mountedRef.current) {
        checkHealth(agentId, true);
      }
    }, POLL_INTERVAL + Math.random() * 5000); // Add jitter

    return () => {
      mountedRef.current = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [agentId]); // Remove checkHealth from deps to avoid re-registering

  const refresh = useCallback(() => {
    if (agentId) {
      return checkHealth(agentId, false);
    }
    return Promise.resolve(null);
  }, [agentId, checkHealth]);

  // Legacy compatibility methods
  const getAgentStatus = useCallback((agentIdToGet: string): AgentHealthStatus | undefined => {
    if (!health || health.agentId !== agentIdToGet) return undefined;
    
    return {
      agentId: health.agentId,
      hasIssues: health.hasIssues,
      unsyncedCount: health.pendingDocuments + health.failedDocuments,
      errorCount: health.failedDocuments,
      warningCount: health.pendingDocuments,
      lastChecked: health.lastChecked
    };
  }, [health]);

  return {
    health,
    isLoading,
    error,
    checkHealth,
    refresh,
    healthStatus: health ? new Map([[health.agentId, getAgentStatus(health.agentId)!]]) : new Map(),
    getAgentStatus,
    hasAnyIssues: () => health?.hasIssues || false,
    getTotalIssueCount: () => health?.hasIssues ? 1 : 0,
    getDetailedIssues: () => ({
      totalAgentsWithIssues: health?.hasIssues ? 1 : 0,
      totalUnsyncedDocs: (health?.pendingDocuments || 0) + (health?.failedDocuments || 0),
      problematicAgents: health?.hasIssues ? [getAgentStatus(health.agentId)!] : []
    })
  };
};

/**
 * Hook per monitorare lo stato globale del pool documenti
 */
export const usePoolDocumentsHealth = () => {
  const [hasIssues, setHasIssues] = useState(false);
  const [issueCount, setIssueCount] = useState(0);
  const [stuckCount, setStuckCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [validatingCount, setValidatingCount] = useState(0);
  const [orphanedChunksCount, setOrphanedChunksCount] = useState(0);
  const [documentsWithoutChunksCount, setDocumentsWithoutChunksCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const checkPoolHealth = async () => {
    setIsLoading(true);
    try {
      const [errorsA, errorsB, errorsC] = await Promise.all([
        supabase
          .from('pipeline_a_documents')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'failed'),
        supabase
          .from('pipeline_b_documents')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'failed'),
        supabase
          .from('pipeline_c_documents')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'failed')
      ]);

      if (errorsA.error || errorsB.error || errorsC.error) {
        console.error('[usePoolDocumentsHealth] Failed to check document errors');
        throw new Error('Failed to check document errors');
      }

      const errors = (errorsA.count || 0) + (errorsB.count || 0) + (errorsC.count || 0);
      
      const totalIssues = errors;
      
      setStuckCount(0);
      setErrorCount(errors);
      setValidatingCount(0);
      setOrphanedChunksCount(0);
      setDocumentsWithoutChunksCount(0);
      setIssueCount(totalIssues);
      setHasIssues(totalIssues > 0);

      if (totalIssues > 0) {
        console.log(`[usePoolDocumentsHealth] Pool has ${totalIssues} documents with issues`);
      }
    } catch (error) {
      console.error('[usePoolDocumentsHealth] Error checking pool health:', error);
      setHasIssues(true);
      setIssueCount(1);
      setStuckCount(0);
      setErrorCount(0);
      setValidatingCount(0);
      setOrphanedChunksCount(0);
      setDocumentsWithoutChunksCount(0);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkPoolHealth();
    const interval = setInterval(checkPoolHealth, 120000);
    return () => clearInterval(interval);
  }, []);

  return {
    hasIssues,
    issueCount,
    stuckCount,
    errorCount,
    validatingCount,
    orphanedChunksCount,
    documentsWithoutChunksCount,
    isLoading,
    refresh: checkPoolHealth
  };
};
