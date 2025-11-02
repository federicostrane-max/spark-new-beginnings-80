import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type TTSStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface TTSContextType {
  currentMessageId: string | null;
  status: TTSStatus;
  playMessage: (messageId: string, text: string) => Promise<void>;
  pause: () => void;
  stop: () => void;
}

const TTSContext = createContext<TTSContextType | undefined>(undefined);

export const TTSProvider = ({ children }: { children: ReactNode }) => {
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [status, setStatus] = useState<TTSStatus>('idle');
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  const playMessage = useCallback(async (messageId: string, text: string) => {
    // Stop current playback if any
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
    }

    setStatus('loading');
    setCurrentMessageId(messageId);

    try {
      const { data, error } = await supabase.functions.invoke('text-to-speech', {
        body: { text, voice: 'alloy' }
      });

      if (error) throw error;

      if (data?.audioContent) {
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
        
        audio.onplay = () => setStatus('playing');
        audio.onpause = () => setStatus('paused');
        audio.onended = () => {
          setStatus('idle');
          setCurrentMessageId(null);
        };
        audio.onerror = () => {
          setStatus('error');
          toast.error("Impossibile riprodurre l'audio");
        };

        setAudioElement(audio);
        await audio.play();
      }
    } catch (error) {
      console.error('TTS error:', error);
      setStatus('error');
      toast.error("Impossibile generare l'audio");
    }
  }, [audioElement]);

  const pause = useCallback(() => {
    if (audioElement) {
      audioElement.pause();
    }
  }, [audioElement]);

  const stop = useCallback(() => {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    setStatus('idle');
    setCurrentMessageId(null);
  }, [audioElement]);

  return (
    <TTSContext.Provider value={{ currentMessageId, status, playMessage, pause, stop }}>
      {children}
    </TTSContext.Provider>
  );
};

export const useTTS = () => {
  const context = useContext(TTSContext);
  if (!context) {
    throw new Error('useTTS must be used within TTSProvider');
  }
  return context;
};
