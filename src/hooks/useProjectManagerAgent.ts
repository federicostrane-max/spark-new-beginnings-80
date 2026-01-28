/**
 * PM Agent Hook - Project Manager Agent with Desktop App Integration
 * 
 * Provides orchestration event subscription and PM-specific tool handling.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { getLauncherClient, configureLauncherClient } from '@/lib/launcher';
import type { OrchestrationEvent, OrchestrationStatus } from '@/lib/launcher';
import { supabase } from '@/integrations/supabase/client';

export interface PMAgentConfig {
  launcherUrl?: string;
  launcherToken?: string;
  onEvent?: (event: OrchestrationEvent) => void;
  onStatusChange?: (status: OrchestrationStatus) => void;
  autoSubscribe?: boolean;
}

export interface PMTask {
  id: string;
  type: string;
  sessionId?: string;
  data?: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
}

export function useProjectManagerAgent(config: PMAgentConfig = {}) {
  const {
    launcherUrl = 'http://localhost:3847',
    launcherToken = '',
    onEvent,
    onStatusChange,
    autoSubscribe = true,
  } = config;

  const [isConnected, setIsConnected] = useState(false);
  const [orchestrationStatus, setOrchestrationStatus] = useState<OrchestrationStatus | null>(null);
  const [pendingTasks, setPendingTasks] = useState<PMTask[]>([]);
  const [error, setError] = useState<string | null>(null);

  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Configure client on mount or config change
  useEffect(() => {
    if (launcherUrl && launcherToken) {
      configureLauncherClient(launcherUrl, launcherToken);
    }
  }, [launcherUrl, launcherToken]);

  // Create PM task based on event
  const createPMTask = useCallback((
    type: string,
    sessionId?: string,
    data?: Record<string, unknown>
  ) => {
    const task: PMTask = {
      id: crypto.randomUUID(),
      type,
      sessionId,
      data,
      status: 'pending',
      createdAt: Date.now(),
    };

    setPendingTasks(prev => [...prev, task]);
    
    // Note: pm_tasks table would need to be created via migration
    // For now, tasks are kept in memory only
    console.log('[PM Agent] Task created:', task);

    return task;
  }, []);

  // Handle orchestration event
  const handleEvent = useCallback((event: OrchestrationEvent) => {
    console.log('[PM Agent] Received event:', event.type, event);

    // Create task based on event type
    switch (event.type) {
      case 'session_created':
        createPMTask('analyze_new_session', event.sessionId, event.data as Record<string, unknown>);
        break;
      case 'session_ready':
        createPMTask('session_ready_check', event.sessionId, event.data as Record<string, unknown>);
        break;
      case 'session_ended':
        createPMTask('session_cleanup', event.sessionId, event.data as Record<string, unknown>);
        break;
      case 'session_output':
        // Don't create task for every output - too noisy
        break;
      case 'heartbeat':
        // Update connection status
        setIsConnected(true);
        break;
    }

    // Call user callback
    onEvent?.(event);
  }, [createPMTask, onEvent]);

  // Subscribe to orchestration events
  const subscribe = useCallback(() => {
    const client = getLauncherClient();
    
    // Unsubscribe from existing connection
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    unsubscribeRef.current = client.subscribeToEvents(handleEvent);
    setIsConnected(true);
    setError(null);

    return unsubscribeRef.current;
  }, [handleEvent]);

  // Unsubscribe from events
  const unsubscribe = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Fetch current orchestration status
  const refreshStatus = useCallback(async () => {
    try {
      const client = getLauncherClient();
      const status = await client.getOrchestrationStatus();
      setOrchestrationStatus(status);
      onStatusChange?.(status);
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch status';
      setError(message);
      throw err;
    }
  }, [onStatusChange]);

  // Process a pending task
  const processTask = useCallback(async (taskId: string) => {
    setPendingTasks(prev => 
      prev.map(t => t.id === taskId ? { ...t, status: 'processing' as const } : t)
    );

    // Task processing would be handled by the agent loop
    // This is just for UI state management
  }, []);

  // Mark task as completed
  const completeTask = useCallback((taskId: string, _result?: Record<string, unknown>) => {
    setPendingTasks(prev => 
      prev.map(t => t.id === taskId ? { ...t, status: 'completed' as const } : t)
    );

    // Note: pm_tasks table would need to be created via migration
    // For now, tasks are kept in memory only
    console.log('[PM Agent] Task completed:', taskId);
  }, []);

  // Auto-subscribe on mount
  useEffect(() => {
    if (autoSubscribe && launcherToken) {
      const unsub = subscribe();
      
      // Also fetch initial status
      refreshStatus().catch(console.error);

      return () => {
        unsub();
      };
    }
  }, [autoSubscribe, launcherToken, subscribe, refreshStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  return {
    // Connection state
    isConnected,
    error,
    
    // Orchestration
    orchestrationStatus,
    refreshStatus,
    
    // Event subscription
    subscribe,
    unsubscribe,
    
    // Task management
    pendingTasks,
    createPMTask,
    processTask,
    completeTask,
    
    // Direct client access
    getClient: getLauncherClient,
  };
}

export default useProjectManagerAgent;
