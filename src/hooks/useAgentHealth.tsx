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
      // Usa check-and-sync-all per logica precisa di sincronizzazione
      const { data, error } = await supabase.functions.invoke('check-and-sync-all', {
        body: { agentId, autoFix: false }
      });

      if (error) {
        logger.error('agent-operation', `Failed to check health for agent ${agentId}`, error, { agentId });
        throw error;
      }

      // Conta documenti realmente non sincronizzati o parzialmente sincronizzati
      const statuses = data?.statuses || [];
      const unsyncedCount = statuses.filter((s: any) => s.status !== 'synced').length;

      // Log dettagliati per documenti problematici
      statuses.forEach((status: any) => {
        if (status.status !== 'synced') {
          logger.warning('document-sync', 
            `Document not synced: ${status.fileName}`, 
            { 
              status: status.status, 
              chunkCount: status.chunkCount,
              expectedChunks: status.expectedChunks 
            }, 
            { agentId, documentId: status.documentId }
          );
        }
      });

      // Conta errori e warning recenti dal logger
      const issues = logger.getAgentIssueCount(agentId, 30);

      // Log dettagliato per capire da dove vengono i warning
      if (issues.warnings > 0) {
        logger.info('agent-operation', `Agent ${agentId} has ${issues.warnings} warnings`, {
          unsyncedCount,
          errorCount: issues.errors,
          warningCount: issues.warnings,
          statuses: statuses.map((s: any) => ({
            fileName: s.fileName,
            status: s.status,
            chunkCount: s.chunkCount
          }))
        }, { agentId });
      }

      const healthStatus: AgentHealthStatus = {
        agentId,
        hasIssues: unsyncedCount > 0 || issues.errors > 0 || issues.warnings > 0,
        unsyncedCount,
        errorCount: issues.errors,
        warningCount: issues.warnings,
        lastChecked: new Date()
      };

      if (healthStatus.hasIssues) {
        logger.warning('agent-operation', `Agent ${agentId} has issues`, {
          unsyncedCount,
          errorCount: issues.errors,
          warningCount: issues.warnings
        }, { agentId });
      }

      return healthStatus;
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

    // Refresh ogni 2 minuti per maggiore stabilità
    const interval = setInterval(refreshHealth, 120000);
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
  const [stuckCount, setStuckCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [validatingCount, setValidatingCount] = useState(0);
  const [orphanedChunksCount, setOrphanedChunksCount] = useState(0);
  const [documentsWithoutChunksCount, setDocumentsWithoutChunksCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const checkPoolHealth = async () => {
    setIsLoading(true);
    try {
      // Note: Documents with processing_status='validated' are in a normal intermediate state
      // They will be automatically processed to 'ready_for_assignment'
      // We don't count them as "stuck" anymore

      // Documenti con errori
      const { count: errorDocCount, error: errorCheckError } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .or('processing_status.eq.error,validation_status.eq.rejected');

      if (errorCheckError) {
        logger.error('pool-documents', 'Failed to check document errors', errorCheckError);
        throw errorCheckError;
      }

      // Documenti bloccati in validazione (più di 1 ora)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: validatingDocCount, error: validatingError } = await supabase
        .from('knowledge_documents')
        .select('id', { count: 'exact', head: true })
        .eq('validation_status', 'validating')
        .lt('created_at', oneHourAgo);

      if (validatingError) {
        logger.error('pool-documents', 'Failed to check validating documents', validatingError);
        throw validatingError;
      }

      const errors = errorDocCount || 0;
      const validating = validatingDocCount || 0;
      
      // Only count real errors and documents stuck in validating too long
      const totalIssues = errors + validating;
      
      setStuckCount(0); // No longer tracking false positive
      setErrorCount(errors);
      setValidatingCount(validating);
      setOrphanedChunksCount(0); // Set by cleanup function
      setDocumentsWithoutChunksCount(0); // Set by cleanup function
      setIssueCount(totalIssues);
      setHasIssues(totalIssues > 0);

      if (totalIssues > 0) {
        logger.warning('pool-documents', `Pool has ${totalIssues} documents with issues`, {
          errorCount: errors,
          validatingCount: validating
        });
      }
    } catch (error) {
      logger.error('pool-documents', 'Error checking pool health', error);
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

    // Refresh ogni 2 minuti per maggiore stabilità
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
