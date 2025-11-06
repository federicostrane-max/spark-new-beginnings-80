import { supabase } from "@/integrations/supabase/client";
import { CheckCircle, AlertTriangle, XCircle, Loader2 } from "lucide-react";

export interface MaintenanceExecutionLog {
  id: string;
  execution_started_at: string;
  execution_completed_at: string | null;
  execution_status: 'running' | 'success' | 'partial_failure' | 'error';
  documents_fixed: number;
  documents_failed: number;
  chunks_cleaned: number;
  agents_synced: number;
  agents_sync_failed: number;
  details: any;
  error_message: string | null;
  created_at: string;
}

export interface MaintenanceOperationDetail {
  id: string;
  execution_log_id: string;
  operation_type: 'fix_stuck_document' | 'cleanup_orphaned_chunk' | 'sync_agent';
  target_id: string;
  target_name: string;
  status: 'success' | 'failed' | 'retry_needed';
  attempt_number: number;
  error_message: string | null;
  created_at: string;
}

export const getExecutionStatusBadge = (status: string) => {
  const badges = {
    running: { color: 'bg-blue-500', icon: Loader2, text: 'In Corso', className: 'animate-spin' },
    success: { color: 'bg-green-500', icon: CheckCircle, text: 'Successo', className: '' },
    partial_failure: { color: 'bg-yellow-500', icon: AlertTriangle, text: 'Parziale', className: '' },
    error: { color: 'bg-red-500', icon: XCircle, text: 'Errore', className: '' }
  };
  return badges[status as keyof typeof badges] || badges.error;
};

export const formatExecutionSummary = (log: MaintenanceExecutionLog): string => {
  const parts: string[] = [];
  
  if (log.documents_fixed > 0) {
    parts.push(`${log.documents_fixed} doc riparati`);
  }
  if (log.chunks_cleaned > 0) {
    parts.push(`${log.chunks_cleaned} chunk eliminati`);
  }
  if (log.agents_synced > 0) {
    parts.push(`${log.agents_synced} agenti sincronizzati`);
  }
  
  if (parts.length === 0) {
    if (log.documents_failed > 0 || log.agents_sync_failed > 0) {
      return `${log.documents_failed + log.agents_sync_failed} errori`;
    }
    return 'Nessuna operazione';
  }
  
  return parts.join(', ');
};

export const fetchMaintenanceLogs = async (limit: number = 50): Promise<MaintenanceExecutionLog[]> => {
  const { data, error } = await supabase
    .from('maintenance_execution_logs')
    .select('*')
    .order('execution_started_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('[maintenanceHelpers] Error fetching logs:', error);
    throw error;
  }
  
  return (data as MaintenanceExecutionLog[]) || [];
};

export const getOperationDetails = async (executionId: string): Promise<MaintenanceOperationDetail[]> => {
  const { data, error } = await supabase
    .from('maintenance_operation_details')
    .select('*')
    .eq('execution_log_id', executionId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('[maintenanceHelpers] Error fetching operation details:', error);
    throw error;
  }
  
  return (data as MaintenanceOperationDetail[]) || [];
};

export const getPersistentProblems = async (): Promise<MaintenanceOperationDetail[]> => {
  const { data, error } = await supabase
    .from('maintenance_operation_details')
    .select('*')
    .eq('status', 'failed')
    .gte('attempt_number', 3)
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (error) {
    console.error('[maintenanceHelpers] Error fetching persistent problems:', error);
    throw error;
  }
  
  return (data as MaintenanceOperationDetail[]) || [];
};

export const getMaintenanceStats = async (): Promise<{
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalDocumentsFixed: number;
  totalChunksCleaned: number;
  totalAgentsSynced: number;
}> => {
  // Get stats from last 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from('maintenance_execution_logs')
    .select('*')
    .gte('execution_started_at', twentyFourHoursAgo);
  
  if (error) {
    console.error('[maintenanceHelpers] Error fetching stats:', error);
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalDocumentsFixed: 0,
      totalChunksCleaned: 0,
      totalAgentsSynced: 0
    };
  }
  
  const logs = data as MaintenanceExecutionLog[];
  
  return {
    totalExecutions: logs.length,
    successfulExecutions: logs.filter(l => l.execution_status === 'success').length,
    failedExecutions: logs.filter(l => l.execution_status === 'error' || l.execution_status === 'partial_failure').length,
    totalDocumentsFixed: logs.reduce((sum, l) => sum + (l.documents_fixed || 0), 0),
    totalChunksCleaned: logs.reduce((sum, l) => sum + (l.chunks_cleaned || 0), 0),
    totalAgentsSynced: logs.reduce((sum, l) => sum + (l.agents_synced || 0), 0)
  };
};

export const triggerManualMaintenance = async (): Promise<{ success: boolean; error?: string }> => {
  try {
    const { data, error } = await supabase.functions.invoke('auto-maintenance');
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
};
