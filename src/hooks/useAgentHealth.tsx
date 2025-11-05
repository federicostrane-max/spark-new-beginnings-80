import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

export interface AgentHealthStatus {
  agentId: string;
  hasIssues: boolean;
  unsyncedCount: number;
  errorCount: number;
  warningCount: number;
  lastChecked: Date;
}

/**
 * Hook per monitorare lo stato di salute degli agenti
 * Traccia documenti non sincronizzati e problemi recenti
 */
export const useAgentHealth = (agentIds: string[]) => {
  const [healthStatus, setHealthStatus] = useState<Map<string, AgentHealthStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const checkAgentHealth = async (agentId: string): Promise<AgentHealthStatus> => {
    try {
      // Verifica documenti assegnati all'agente
      const { data: assignedDocs, error: assignError } = await supabase
        .from('agent_document_links')
        .select('document_id')
        .eq('agent_id', agentId);

      if (assignError) {
        logger.error('agent-operation', `Failed to check health for agent ${agentId}`, assignError, { agentId });
        throw assignError;
      }

      const documentIds = assignedDocs?.map(d => d.document_id) || [];

      if (documentIds.length === 0) {
        return {
          agentId,
          hasIssues: false,
          unsyncedCount: 0,
          errorCount: 0,
          warningCount: 0,
          lastChecked: new Date()
        };
      }

      // Verifica quanti documenti non sono sincronizzati
      const { data: knowledgeData, error: knowledgeError } = await supabase
        .from('agent_knowledge')
        .select('id, pool_document_id')
        .eq('agent_id', agentId)
        .in('pool_document_id', documentIds);

      if (knowledgeError) {
        logger.error('document-sync', `Failed to check synced documents for agent ${agentId}`, knowledgeError, { agentId });
        throw knowledgeError;
      }

      const syncedDocIds = new Set(knowledgeData?.map(k => k.pool_document_id) || []);
      const unsyncedCount = documentIds.filter(id => !syncedDocIds.has(id)).length;

      // Conta errori e warning recenti dal logger
      const issues = logger.getAgentIssueCount(agentId, 30);

      const status: AgentHealthStatus = {
        agentId,
        hasIssues: unsyncedCount > 0 || issues.errors > 0 || issues.warnings > 0,
        unsyncedCount,
        errorCount: issues.errors,
        warningCount: issues.warnings,
        lastChecked: new Date()
      };

      if (status.hasIssues) {
        logger.warning('agent-operation', `Agent ${agentId} has issues`, {
          unsyncedCount,
          errorCount: issues.errors,
          warningCount: issues.warnings
        }, { agentId });
      }

      return status;
    } catch (error) {
      logger.error('agent-operation', `Error checking agent health for ${agentId}`, error, { agentId });
      return {
        agentId,
        hasIssues: true,
        unsyncedCount: 0,
        errorCount: 1,
        warningCount: 0,
        lastChecked: new Date()
      };
    }
  };

  const refreshHealth = async () => {
    if (agentIds.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const results = await Promise.all(
        agentIds.map(id => checkAgentHealth(id))
      );

      const newHealthMap = new Map<string, AgentHealthStatus>();
      results.forEach(status => {
        newHealthMap.set(status.agentId, status);
      });

      setHealthStatus(newHealthMap);
      logger.info('agent-operation', `Health check completed for ${agentIds.length} agents`);
    } catch (error) {
      logger.error('agent-operation', 'Failed to refresh agent health', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshHealth();

    // Refresh ogni 30 secondi
    const interval = setInterval(refreshHealth, 30000);
    return () => clearInterval(interval);
  }, [agentIds.join(',')]);

  const getAgentStatus = (agentId: string): AgentHealthStatus | undefined => {
    return healthStatus.get(agentId);
  };

  const hasAnyIssues = (): boolean => {
    return Array.from(healthStatus.values()).some(status => status.hasIssues);
  };

  const getTotalIssueCount = (): number => {
    return Array.from(healthStatus.values()).reduce(
      (total, status) => total + (status.hasIssues ? 1 : 0),
      0
    );
  };

  return {
    healthStatus: healthStatus,
    isLoading,
    refreshHealth,
    getAgentStatus,
    hasAnyIssues,
    getTotalIssueCount
  };
};

/**
 * Hook per monitorare lo stato globale del pool documenti
 */
export const usePoolDocumentsHealth = () => {
  const [hasIssues, setHasIssues] = useState(false);
  const [issueCount, setIssueCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const checkPoolHealth = async () => {
    setIsLoading(true);
    try {
      // Documenti validati ma non processati
      const { count: stuckCount, error: stuckError } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .eq('validation_status', 'validated')
        .eq('processing_status', 'downloaded');

      if (stuckError) {
        logger.error('pool-documents', 'Failed to check pool health', stuckError);
        throw stuckError;
      }

      // Documenti con errori
      const { count: errorCount, error: errorCheckError } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .or('processing_status.eq.error,validation_status.eq.rejected');

      if (errorCheckError) {
        logger.error('pool-documents', 'Failed to check document errors', errorCheckError);
        throw errorCheckError;
      }

      const totalIssues = (stuckCount || 0) + (errorCount || 0);
      setIssueCount(totalIssues);
      setHasIssues(totalIssues > 0);

      if (totalIssues > 0) {
        logger.warning('pool-documents', `Pool has ${totalIssues} documents with issues`, {
          stuckCount,
          errorCount
        });
      }
    } catch (error) {
      logger.error('pool-documents', 'Error checking pool health', error);
      setHasIssues(true);
      setIssueCount(1);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkPoolHealth();

    // Refresh ogni 30 secondi
    const interval = setInterval(checkPoolHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return {
    hasIssues,
    issueCount,
    isLoading,
    refresh: checkPoolHealth
  };
};
