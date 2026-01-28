/**
 * React hooks for Claude Launcher Desktop App integration
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  getLauncherClient, 
  configureLauncherClient,
  type OrchestrationStatus,
  type OrchestrationEvent,
} from '@/lib/launcher';

// ============================================================================
// useLauncherClient - Main client hook
// ============================================================================

export function useLauncherClient() {
  const client = useMemo(() => getLauncherClient(), []);

  const updateConfig = useCallback((url: string, token: string) => {
    configureLauncherClient(url, token);
  }, []);

  const isConfigured = useMemo(() => {
    return !!client.getToken();
  }, [client]);

  return { client, updateConfig, isConfigured };
}

// ============================================================================
// useOrchestrationEvents - SSE subscription hook
// ============================================================================

export function useOrchestrationEvents(
  onEvent: (event: OrchestrationEvent) => void,
  enabled: boolean = true
) {
  const { client, isConfigured } = useLauncherClient();
  
  // Use ref to avoid re-subscribing when onEvent changes
  const onEventRef = useRef(onEvent);
  
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || !isConfigured) return;

    const unsubscribe = client.subscribeToEvents(
      (event) => onEventRef.current(event),
      { reconnect: true, maxRetries: 5 }
    );

    return unsubscribe;
  }, [client, enabled, isConfigured]);
}

// ============================================================================
// useOrchestrationStatus - Polling status hook
// ============================================================================

interface UseOrchestrationStatusOptions {
  pollInterval?: number;
  enabled?: boolean;
}

export function useOrchestrationStatus(options: UseOrchestrationStatusOptions = {}) {
  const { pollInterval = 5000, enabled = true } = options;
  const { client, isConfigured } = useLauncherClient();
  
  const [status, setStatus] = useState<OrchestrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isConfigured) {
      setLoading(false);
      setError('Launcher client not configured');
      return;
    }

    try {
      setLoading(true);
      const data = await client.getOrchestrationStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [client, isConfigured]);

  useEffect(() => {
    if (!enabled || !isConfigured) return;

    refresh();
    const interval = setInterval(refresh, pollInterval);
    return () => clearInterval(interval);
  }, [refresh, pollInterval, enabled, isConfigured]);

  return { status, loading, error, refresh };
}

// ============================================================================
// useLauncherSessions - Sessions list hook
// ============================================================================

export function useLauncherSessions(pollInterval?: number) {
  const { client, isConfigured } = useLauncherClient();
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof client.getSessions>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await client.getSessions();
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [client, isConfigured]);

  useEffect(() => {
    refresh();
    
    if (pollInterval && pollInterval > 0) {
      const interval = setInterval(refresh, pollInterval);
      return () => clearInterval(interval);
    }
  }, [refresh, pollInterval]);

  return { sessions, loading, error, refresh };
}

// ============================================================================
// useLauncherHealth - Health check hook
// ============================================================================

export function useLauncherHealth(pollInterval: number = 10000) {
  const { client, isConfigured } = useLauncherClient();
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    if (!isConfigured) {
      setHealthy(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const result = await client.healthCheck();
      setHealthy(result.healthy);
    } catch {
      setHealthy(false);
    } finally {
      setLoading(false);
    }
  }, [client, isConfigured]);

  useEffect(() => {
    check();
    const interval = setInterval(check, pollInterval);
    return () => clearInterval(interval);
  }, [check, pollInterval]);

  return { healthy, loading, check };
}
