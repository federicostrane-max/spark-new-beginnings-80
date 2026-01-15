/**
 * AutoPairingProvider - v10.3.0
 *
 * Componente invisibile che fa polling su localhost:8766 per rilevare
 * il Tool Server e completare il pairing automaticamente.
 *
 * Deve essere montato quando l'utente è loggato (dentro ProtectedRoute).
 */

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toolServerClient } from '@/lib/tool-server';
import { toast } from 'sonner';

const LOCALHOST_URL = 'http://localhost:8766';
const POLLING_INTERVAL = 3000; // 3 secondi

export const AutoPairingProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const isPollingRef = useRef(false);
  const hasCompletedPairingRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (hasCompletedPairingRef.current) return;

    let isMounted = true;
    isPollingRef.current = true;

    const pollLocalhost = async () => {
      while (isPollingRef.current && isMounted) {
        try {
          const response = await fetch(`${LOCALHOST_URL}/pairing_status`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });

          if (response.ok) {
            const data = await response.json();
            console.log('[AutoPairing] Localhost status:', data);

            // Se Tool Server è in attesa di pairing e non è già paired
            if (data.waiting_for_pairing && !data.paired) {
              console.log('[AutoPairing] Tool Server rilevato, invio credenziali...');
              const success = await performAutoPairing();
              if (success) {
                hasCompletedPairingRef.current = true;
                isPollingRef.current = false;
                break;
              }
            } else if (data.paired) {
              // Già paired, ferma il polling
              console.log('[AutoPairing] Tool Server già paired');
              hasCompletedPairingRef.current = true;
              isPollingRef.current = false;
              break;
            }
          }
        } catch (err) {
          // Tool Server non raggiungibile, continua polling silenziosamente
        }

        // Aspetta prima del prossimo tentativo
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
      }
    };

    const performAutoPairing = async (): Promise<boolean> => {
      try {
        // Chiama edge function per creare/ottenere credenziali
        const { data, error } = await supabase.functions.invoke('tool-server-pair', {
          body: { action: 'create_auto_pair_credentials' }
        });

        if (error || !data?.success) {
          console.error('[AutoPairing] Failed to get credentials:', error || data?.error);
          return false;
        }

        // Invia credenziali al Tool Server locale
        const pairResponse = await fetch(`${LOCALHOST_URL}/auto_pair`, {
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
            console.log('[AutoPairing] Completato:', result);

            // Aggiorna URL nel client se disponibile
            if (result.ngrok_url) {
              toolServerClient.updateBaseUrl(result.ngrok_url);
            }

            return true;
          }
        }
      } catch (err) {
        console.error('[AutoPairing] Failed:', err);
      }
      return false;
    };

    // Avvia polling
    pollLocalhost();

    return () => {
      isMounted = false;
      isPollingRef.current = false;
    };
  }, [user]);

  return <>{children}</>;
};
