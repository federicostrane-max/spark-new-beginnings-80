import { useState, useEffect, useCallback } from 'react';
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
const POLL_INTERVAL = 30 * 1000; // 30 seconds
const REQUEST_TIMEOUT = 5000; // 5 seconds

export interface AgentHealthStatus {
  agentId: string;
  hasIssues: boolean;
  unsyncedCount: number;
  errorCount: number;
  warningCount: number;
  lastChecked: Date;
}

/**
 * Hook per monitorare lo stato di salute di UN SINGOLO agente
 * Usa cache locale e polling intelligente per evitare timeout
 */
export const useAgentHealth = (agentId?: string) => {
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async (agentIdToCheck: string, useCache: boolean = true): Promise<AgentHealth | null> => {
    // Check cache first
    if (useCache && health && health.agentId === agentIdToCheck) {
      const age = Date.now() - health.lastChecked.getTime();
      if (age < CACHE_DURATION) {
        console.log(`[useAgentHealth] Using cached health data (${Math.round(age / 1000)}s old)`);
        return health;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      // Implement client-side timeout
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT)
      );

      const healthCheckPromise = supabase.functions.invoke('check-agent-health', {
        body: { agentId: agentIdToCheck }
      });

      const { data, error: invokeError } = await Promise.race([
        healthCheckPromise,
        timeoutPromise
      ]) as any;

      if (invokeError) throw invokeError;

      if (data?.success && data.health) {
        const newHealth: AgentHealth = {
          ...data.health,
          lastChecked: new Date(),
          isStale: false
        };
        setHealth(newHealth);
        return newHealth;
      } else {
        throw new Error(data?.error || 'Failed to fetch health status');
      }

    } catch (err: any) {
      console.error('[useAgentHealth] Health check failed:', err);
      
      // On timeout or error, mark cached data as stale but keep it
      if (health && health.agentId === agentIdToCheck) {
        const staleHealth = { ...health, isStale: true };
        setHealth(staleHealth);
        setError('Status unavailable (using cached data)');
        return staleHealth;
      }
      
      setError(err.message || 'Failed to check health');
      return null;

    } finally {
      setIsLoading(false);
    }
  }, [health]);

  // Auto-poll when agentId is provided
  useEffect(() => {
    if (!agentId) return;

    // Initial check
    checkHealth(agentId, true);

    // Set up polling
    const interval = setInterval(() => {
      checkHealth(agentId, true);
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [agentId, checkHealth]);

  const refresh = useCallback(() => {
    if (agentId) {
      return checkHealth(agentId, false); // Force fresh check
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
    // Legacy compatibility
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
      // Check ALL pipelines for failed documents
      const [errorsA, errorsB, errorsC] = await Promise.all([
        supabase.from('pipeline_a_documents').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase.from('pipeline_b_documents').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase.from('pipeline_c_documents').select('id', { count: 'exact', head: true }).eq('status', 'failed')
      ]);

      const errorCount = (errorsA.count || 0) + (errorsB.count || 0) + (errorsC.count || 0);
      
      setStuckCount(0);
      setErrorCount(errorCount);
      setValidatingCount(0);
      setOrphanedChunksCount(0);
      setDocumentsWithoutChunksCount(0);
      setIssueCount(errorCount);
      setHasIssues(errorCount > 0);

      if (errorCount > 0) {
        console.log(`[usePoolDocumentsHealth] Pool has ${errorCount} failed documents`);
      }
    } catch (error) {
      console.error('[usePoolDocumentsHealth] Error checking pool health:', error);
      setHasIssues(false);
      setIssueCount(0);
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

