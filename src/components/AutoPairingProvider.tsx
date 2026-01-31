/**
 * AutoPairingProvider - v10.4.0
 *
 * Componente invisibile che fa polling parallelo per rilevare e configurare
 * automaticamente sia il Tool Server (localhost:8766) che la Desktop App (localhost:3847).
 *
 * Deve essere montato quando l'utente è loggato (dentro ProtectedRoute).
 */

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toolServerClient } from '@/lib/tool-server';
import { configureLauncherClient } from '@/lib/launcher/client';
import { toast } from 'sonner';

const TOOL_SERVER_URL = 'http://localhost:8766';
const DESKTOP_APP_URL = 'http://localhost:3847';
const POLLING_INTERVAL = 3000; // 3 secondi

export const AutoPairingProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const isPollingRef = useRef(false);
  const hasCompletedToolServerPairingRef = useRef(false);
  const hasCompletedDesktopPairingRef = useRef(false);

  // ── Tool Server auto-pairing (porta 8766) ──────────────────────────────
  useEffect(() => {
    if (!user) return;
    if (hasCompletedToolServerPairingRef.current) return;

    let isMounted = true;
    isPollingRef.current = true;

    const pollToolServer = async () => {
      while (isPollingRef.current && isMounted) {
        try {
          const response = await fetch(`${TOOL_SERVER_URL}/pairing_status`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });

          if (response.ok) {
            const data = await response.json();
            console.log('[AutoPairing:ToolServer] Status:', data);

            if (data.waiting_for_pairing && !data.paired) {
              console.log('[AutoPairing:ToolServer] Rilevato, invio credenziali...');
              const success = await performToolServerPairing();
              if (success) {
                hasCompletedToolServerPairingRef.current = true;
                break;
              }
            } else if (data.paired) {
              console.log('[AutoPairing:ToolServer] Già paired');
              hasCompletedToolServerPairingRef.current = true;
              break;
            }
          }
        } catch (err) {
          // Tool Server non raggiungibile, continua polling
        }

        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
      }
    };

    const performToolServerPairing = async (): Promise<boolean> => {
      try {
        const { data, error } = await supabase.functions.invoke('tool-server-pair', {
          body: { action: 'create_auto_pair_credentials' }
        });

        if (error || !data?.success) {
          console.error('[AutoPairing:ToolServer] Failed to get credentials:', error || data?.error);
          return false;
        }

        const pairResponse = await fetch(`${TOOL_SERVER_URL}/auto_pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: data.user_id,
            device_secret: data.device_secret,
            supabase_url: data.supabase_url,
            function_url: data.function_url
          })
        });

        if (pairResponse.ok) {
          const result = await pairResponse.json();
          if (result.success) {
            toast.success("Tool Server collegato automaticamente!");
            console.log('[AutoPairing:ToolServer] Completato:', result);

            if (result.ngrok_url) {
              toolServerClient.updateBaseUrl(result.ngrok_url);
            }

            return true;
          }
        }
      } catch (err) {
        console.error('[AutoPairing:ToolServer] Failed:', err);
      }
      return false;
    };

    pollToolServer();

    return () => {
      isMounted = false;
      isPollingRef.current = false;
    };
  }, [user]);

  // ── Desktop App auto-pairing (porta 3847) ──────────────────────────────
  useEffect(() => {
    if (!user) return;
    if (hasCompletedDesktopPairingRef.current) return;

    // Se già configurato in localStorage con un token valido, verifica connessione una volta
    const savedToken = localStorage.getItem('launcher_api_token');
    if (savedToken) {
      verifyDesktopConnection(savedToken).then(alive => {
        if (alive) {
          hasCompletedDesktopPairingRef.current = true;
          console.log('[AutoPairing:Desktop] Già configurato e connesso');
        } else {
          // Token salvato ma Desktop App non raggiungibile - avvia polling
          console.log('[AutoPairing:Desktop] Token salvato ma non raggiungibile, avvio polling...');
          startDesktopPolling();
        }
      });
      return;
    }

    // Nessun token salvato - avvia polling
    startDesktopPolling();

    function startDesktopPolling() {
      let isMounted = true;

      const pollDesktopApp = async () => {
        while (isMounted && !hasCompletedDesktopPairingRef.current) {
          try {
            const response = await fetch(`${DESKTOP_APP_URL}/api/pairing/info`, {
              method: 'GET',
              headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
              const data = await response.json();
              console.log('[AutoPairing:Desktop] Rilevata:', data);

              if (data.token && data.enabled !== false) {
                // Configura automaticamente
                configureLauncherClient(DESKTOP_APP_URL, data.token);
                hasCompletedDesktopPairingRef.current = true;
                toast.success("Desktop App collegata automaticamente!");
                console.log('[AutoPairing:Desktop] Completato');
                break;
              }
            }
          } catch (err) {
            // Desktop App non raggiungibile, continua polling
          }

          await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
        }
      };

      pollDesktopApp();

      // Cleanup non necessario qui perché il ref gestisce lo stop
    }
  }, [user]);

  return <>{children}</>;
};

async function verifyDesktopConnection(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${DESKTOP_APP_URL}/api/sessions`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-API-Token': token
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}
