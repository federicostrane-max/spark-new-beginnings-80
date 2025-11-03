import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type TTSStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface AudioCache {
  [key: string]: string; // messageId -> blob URL
}

interface TTSContextType {
  currentMessageId: string | null;
  status: TTSStatus;
  playMessage: (messageId: string, text: string) => Promise<void>;
  pause: () => void;
  stop: () => void;
  preGenerateAudio: (messageId: string, text: string) => Promise<void>;
}

const TTSContext = createContext<TTSContextType | undefined>(undefined);

export const TTSProvider = ({ children }: { children: ReactNode }) => {
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [status, setStatus] = useState<TTSStatus>('idle');
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [audioCache, setAudioCache] = useState<AudioCache>({});

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(audioCache).forEach(url => URL.revokeObjectURL(url));
    };
  }, [audioCache]);

  // Shared function to fetch and cache audio
  const fetchAudioBlob = useCallback(async (text: string): Promise<string> => {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ text, voice: 'alloy' }), // OpenAI voice
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to generate audio');
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }, []);

  // Pre-create Audio element for instant playback
  const preloadAudioElement = useCallback((messageId: string) => {
    const blobUrl = audioCache[messageId];
    if (!blobUrl) return;
    
    // Create a hidden audio element ready to play
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = blobUrl;
    
    // This forces the browser to buffer the audio
    audio.load();
  }, [audioCache]);

  // Pre-generate audio in background (cache only, no playback)
  const preGenerateAudio = useCallback(async (messageId: string, text: string) => {
    // Don't pre-generate if already cached or empty
    if (audioCache[messageId] || !text.trim()) return;

    try {
      console.log('Pre-generating audio for message:', messageId);
      const blobUrl = await fetchAudioBlob(text);
      setAudioCache(prev => ({ ...prev, [messageId]: blobUrl }));
      console.log('Audio pre-generated successfully');
      
      // Pre-load audio element for instant playback
      preloadAudioElement(messageId);
    } catch (error) {
      console.error('Error pre-generating audio:', error);
      // Silent fail for background pre-generation
    }
  }, [audioCache, fetchAudioBlob, preloadAudioElement]);

  const playMessage = useCallback(async (messageId: string, text: string) => {
    // Prevent multiple simultaneous requests
    if (status === 'loading') {
      console.log('Already loading, ignoring request');
      return;
    }

    // Stop current playback if any with proper cleanup
    if (audioElement) {
      // Remove all event handlers first
      audioElement.onplay = null;
      audioElement.onpause = null;
      audioElement.onended = null;
      audioElement.onerror = null;
      audioElement.oncanplaythrough = null;
      
      audioElement.pause();
      audioElement.src = '';
      setAudioElement(null);
    }

    setStatus('loading');
    setCurrentMessageId(messageId);

    try {
      let blobUrl = audioCache[messageId];

      // If not cached, fetch it now
      if (!blobUrl) {
        console.log('Audio not cached, fetching...');
        blobUrl = await fetchAudioBlob(text);
        setAudioCache(prev => ({ ...prev, [messageId]: blobUrl }));
      } else {
        console.log('Playing cached audio');
      }

      // Create audio element IMMEDIATELY with cached blob
      const audio = new Audio();
      audio.preload = 'auto';
      
      // Set up event handlers BEFORE setting src
      audio.oncanplaythrough = () => {
        console.log('Audio ready to play');
      };
      
      audio.onplay = () => {
        console.log('Audio playing');
        setStatus('playing');
      };
      
      audio.onpause = () => {
        console.log('Audio paused');
        // Only update status if we're still playing this message
        setStatus(prev => prev === 'playing' ? 'paused' : prev);
      };
      
      audio.onended = () => {
        console.log('Audio ended');
        setStatus('idle');
        setCurrentMessageId(null);
        setAudioElement(null);
      };
      
      audio.onerror = (e) => {
        console.error('Audio error:', e);
        setStatus('error');
        setCurrentMessageId(null);
        setAudioElement(null);
        toast.error('Errore nella riproduzione audio');
        // Remove from cache if playback fails
        setAudioCache(prev => {
          const newCache = { ...prev };
          delete newCache[messageId];
          URL.revokeObjectURL(blobUrl);
          return newCache;
        });
      };

      // Set src and save audio element
      audio.src = blobUrl;
      setAudioElement(audio);
      
      // Try to play immediately
      await audio.play();
    } catch (error) {
      console.error('TTS error:', error);
      setStatus('error');
      setCurrentMessageId(null);
      setAudioElement(null);
      toast.error('Errore nella riproduzione audio');
    }
  }, [audioElement, status, audioCache, fetchAudioBlob]);

  const pause = useCallback(() => {
    if (audioElement) {
      setStatus('paused');
      audioElement.pause();
    }
  }, [audioElement]);

  const stop = useCallback(() => {
    if (audioElement) {
      // Remove event handlers FIRST to prevent async updates
      audioElement.onplay = null;
      audioElement.onpause = null;
      audioElement.onended = null;
      audioElement.onerror = null;
      audioElement.oncanplaythrough = null;
      
      // Then stop playback
      audioElement.pause();
      audioElement.currentTime = 0;
      audioElement.src = ''; // Release the blob URL reference
    }
    
    // Finally update state
    setStatus('idle');
    setCurrentMessageId(null);
    setAudioElement(null);
  }, [audioElement]);

  return (
    <TTSContext.Provider value={{ currentMessageId, status, playMessage, pause, stop, preGenerateAudio }}>
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
