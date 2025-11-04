import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ChevronLeft, ChevronRight, Volume2, VolumeX, Maximize, Palette, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PresentationSlide {
  title: string;
  content: string[];
  type: 'title' | 'content' | 'bullets' | 'conclusion';
}

type Theme = 'aurora' | 'midnight' | 'ocean' | 'sunset' | 'forest' | 'minimal';

const themes: Record<Theme, { bg: string; accent: string; text: string }> = {
  aurora: {
    bg: 'from-purple-900 via-pink-800 to-indigo-900',
    accent: 'bg-pink-500',
    text: 'text-white'
  },
  midnight: {
    bg: 'from-slate-900 via-blue-900 to-slate-900',
    accent: 'bg-blue-400',
    text: 'text-white'
  },
  ocean: {
    bg: 'from-cyan-900 via-teal-800 to-blue-900',
    accent: 'bg-cyan-400',
    text: 'text-white'
  },
  sunset: {
    bg: 'from-orange-800 via-red-700 to-purple-900',
    accent: 'bg-orange-400',
    text: 'text-white'
  },
  forest: {
    bg: 'from-emerald-900 via-green-800 to-teal-900',
    accent: 'bg-emerald-400',
    text: 'text-white'
  },
  minimal: {
    bg: 'from-gray-50 via-white to-gray-100',
    accent: 'bg-gray-900',
    text: 'text-gray-900'
  }
};

const Presentation = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [slides, setSlides] = useState<PresentationSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [theme, setTheme] = useState<Theme>('aurora');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [visibleContentItems, setVisibleContentItems] = useState<number[]>([]);
  const [animationInProgress, setAnimationInProgress] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoPlayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const controlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isGeneratingAudioRef = useRef(false);
  const animationTimersRef = useRef<NodeJS.Timeout[]>([]);
  
  // Audio cache for prefetching
  const audioCacheRef = useRef<Map<number, string>>(new Map());
  const prefetchingRef = useRef<Set<number>>(new Set());

  const messageId = searchParams.get("messageId");
  const agentId = searchParams.get("agentId");

  useEffect(() => {
    if (!messageId) {
      toast.error("No message ID provided");
      navigate("/");
      return;
    }

    loadMessageAndGeneratePresentation();
  }, [messageId]);

  const loadMessageAndGeneratePresentation = async () => {
    try {
      setLoading(true);

      // Fetch the message content
      const { data: message, error: messageError } = await supabase
        .from("agent_messages")
        .select("content, role")
        .eq("id", messageId)
        .single();

      if (messageError || !message) {
        throw new Error("Failed to load message");
      }

      if (message.role !== "assistant") {
        toast.error("Can only create presentations from assistant messages");
        navigate("/");
        return;
      }

      // Get agent name for title
      let presentationTitle = "AI Presentation";
      if (agentId) {
        const { data: agent } = await supabase
          .from("agents")
          .select("name")
          .eq("id", agentId)
          .single();
        
        if (agent) {
          presentationTitle = `${agent.name} - Insights`;
        }
      }

      // Generate presentation structure using AI
      const { data: structureData, error: structureError } = await supabase.functions.invoke(
        'generate-presentation-structure',
        {
          body: {
            text: message.content,
            title: presentationTitle
          }
        }
      );

      if (structureError) {
        throw structureError;
      }

      const generatedSlides = structureData?.slides || [];
      
      if (generatedSlides.length === 0) {
        throw new Error("No slides generated");
      }

      setSlides(generatedSlides);
      toast.success(`Presentation created with ${generatedSlides.length} slides`);

    } catch (error) {
      console.error("Error generating presentation:", error);
      toast.error("Failed to generate presentation");
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  // Clear all animation timers
  const clearAnimationTimers = () => {
    animationTimersRef.current.forEach(timer => clearTimeout(timer));
    animationTimersRef.current = [];
  };

  // Schedule progressive reveal: show content as audio reads it
  const scheduleProgressiveReveal = (contentItemsCount: number, delayBeforeStart: number = 1100) => {
    clearAnimationTimers();
    setVisibleContentItems([]);
    setAnimationInProgress(true);
    
    if (contentItemsCount === 0) {
      setAnimationInProgress(false);
      return;
    }

    // For title slides, show everything immediately
    if (contentItemsCount === 1) {
      const timer = setTimeout(() => {
        setVisibleContentItems([0]);
        setAnimationInProgress(false);
      }, delayBeforeStart);
      animationTimersRef.current.push(timer);
      return;
    }

    // Show items progressively, starting after the initial delay
    // Each item appears just before the audio reads it
    const timePerItem = 2000; // 2 seconds per item
    
    for (let i = 0; i < contentItemsCount; i++) {
      const delay = delayBeforeStart + (i * timePerItem);
      const timer = setTimeout(() => {
        setVisibleContentItems(prev => [...prev, i]);
        if (i === contentItemsCount - 1) {
          setAnimationInProgress(false);
        }
      }, delay);
      animationTimersRef.current.push(timer);
    }
  };


  // Prefetch audio for a specific slide
  const prefetchAudio = async (slideIndex: number) => {
    if (slideIndex < 0 || slideIndex >= slides.length) return;
    if (audioCacheRef.current.has(slideIndex)) return;
    if (prefetchingRef.current.has(slideIndex)) return;
    
    prefetchingRef.current.add(slideIndex);
    const slide = slides[slideIndex];
    
    try {
      console.log(`🔄 Prefetching audio for slide ${slideIndex + 1}...`);
      
      // Add a brief pause at the start to prevent cut-off audio
      const textToSpeak = `... ${slide.title}. ${slide.content.join('. ')}`;
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({ 
            text: textToSpeak, 
            voice: 'alloy' // Changed from 'nova' for better quality
          })
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      audioCacheRef.current.set(slideIndex, audioUrl);
      
      console.log(`✅ Prefetched audio for slide ${slideIndex + 1}`);
    } catch (error) {
      console.error(`❌ Failed to prefetch audio for slide ${slideIndex + 1}:`, error);
    } finally {
      prefetchingRef.current.delete(slideIndex);
    }
  };

  // Play audio for current slide (with cache support)
  const playSlideAudio = async (slide: PresentationSlide, slideIndex: number, onComplete?: () => void) => {
    if (!isAudioEnabled && !isAutoPlaying) return;

    if (isGeneratingAudioRef.current) {
      console.log('⚠️ Audio generation already in progress, skipping...');
      return;
    }

    isGeneratingAudioRef.current = true;

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlayingAudio(false);
    }

    try {
      let audioUrl = audioCacheRef.current.get(slideIndex);
      
      if (!audioUrl) {
        // Not in cache, generate it
        setIsLoadingAudio(true);
        console.log(`⏳ Loading audio for slide ${slideIndex + 1}...`);

        // Add a brief pause at the start to prevent cut-off audio
        const textToSpeak = `... ${slide.title}. ${slide.content.join('. ')}`;
        const { data: { session } } = await supabase.auth.getSession();
        
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ 
              text: textToSpeak, 
              voice: 'alloy' // Changed from 'nova' for better quality
            })
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        console.log('✅ TTS response OK, creating audio...');
        const audioBlob = await response.blob();
        audioUrl = URL.createObjectURL(audioBlob);
        
        // Cache for future use
        audioCacheRef.current.set(slideIndex, audioUrl);
      } else {
        console.log(`♻️ Using cached audio for slide ${slideIndex + 1}`);
      }

      // Create and play audio
      const audio = new Audio();
      audio.src = audioUrl;
      audioRef.current = audio;

      // Schedule content to appear progressively
      const contentCount = slide.content.length;
      scheduleProgressiveReveal(contentCount, 0); // Start immediately, first item shows after 1.1s
      
      audio.oncanplaythrough = async () => {
        try {
          // Wait 1 second to let user see ALL content before audio starts
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          console.log('▶️ Starting audio playback...');
          setIsLoadingAudio(false);
          setIsPlayingAudio(true);
          
          // Small delay to prevent cut-off
          await new Promise(resolve => setTimeout(resolve, 100));
          await audio.play();
          console.log('🎶 Audio playing!');
          
          // Prefetch next slide audio while playing
          if (slideIndex + 1 < slides.length) {
            prefetchAudio(slideIndex + 1);
          }
        } catch (playError) {
          console.error('❌ Audio play error:', playError);
          setIsLoadingAudio(false);
          setIsPlayingAudio(false);
          toast.error('Errore riproduzione audio');
        }
      };

      audio.onended = () => {
        console.log('✅ Audio playback completed');
        setIsPlayingAudio(false);
        if (onComplete) {
          onComplete();
        }
      };

      audio.onerror = (e) => {
        console.error('❌ Audio playback error:', e);
        setIsPlayingAudio(false);
        setIsLoadingAudio(false);
        toast.error('Errore riproduzione audio');
        
        if (isAutoPlaying && onComplete) {
          setTimeout(onComplete, 1000);
        }
      };
      
    } catch (error) {
      console.error('❌ Error in TTS:', error);
      setIsLoadingAudio(false);
      setIsPlayingAudio(false);
      toast.error('Errore generazione audio');
      
      if (isAutoPlaying && onComplete) {
        setTimeout(onComplete, 2000);
      }
    } finally {
      isGeneratingAudioRef.current = false;
    }
  };

  // Auto-play functionality
  const startAutoPlay = async () => {
    setIsAutoPlaying(true);
    setCurrentSlide(0);
    
    // Prefetch first two slides before starting
    await Promise.all([
      prefetchAudio(0),
      prefetchAudio(1)
    ]);
    
    const playNext = async (index: number) => {
      if (index >= slides.length) {
        setIsAutoPlaying(false);
        toast.success('Presentazione completata!');
        return;
      }

      await playSlideAudio(slides[index], index, () => {
        if (index < slides.length - 1) {
          setCurrentSlide(index + 1);
          autoPlayTimerRef.current = setTimeout(() => {
            playNext(index + 1);
          }, 500);
        } else {
          setIsAutoPlaying(false);
          toast.success('Presentazione completata!');
        }
      });
    };

    await playNext(0);
  };

  const stopAutoPlay = () => {
    setIsAutoPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (autoPlayTimerRef.current) {
      clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    setIsPlayingAudio(false);
  };

  // Manual audio play when slide changes (only if not auto-playing)
  useEffect(() => {
    if (slides.length > 0 && isAudioEnabled && !isAutoPlaying) {
      playSlideAudio(slides[currentSlide], currentSlide);
    }

    return () => {
      if (audioRef.current && !isAutoPlaying) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      clearAnimationTimers();
    };
  }, [currentSlide, slides, isAudioEnabled]);

  // Cleanup cache on unmount
  useEffect(() => {
    return () => {
      // Clean up all cached audio URLs
      audioCacheRef.current.forEach(url => URL.revokeObjectURL(url));
      audioCacheRef.current.clear();
      clearAnimationTimers();
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (autoPlayTimerRef.current) {
        clearTimeout(autoPlayTimerRef.current);
      }
    };
  }, []);

  const nextSlide = () => {
    if (isAutoPlaying) return;
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (isAutoPlaying) return;
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const toggleAudio = () => {
    if (isLoadingAudio) return;
    
    const newState = !isAudioEnabled;
    setIsAudioEnabled(newState);
    
    if (audioRef.current && !newState) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    }
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
      toast.error('Impossibile attivare fullscreen');
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      if (!isFs) {
        setShowControls(true); // Always show controls when exiting fullscreen
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Handle controls auto-hide in fullscreen
  const resetControlsTimer = () => {
    if (!isFullscreen) return;
    
    setShowControls(true);
    
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    
    controlsTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000); // Hide after 3 seconds of inactivity
  };

  // Show controls on interaction
  useEffect(() => {
    if (!isFullscreen) return;

    const handleInteraction = () => {
      resetControlsTimer();
    };

    window.addEventListener('click', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);
    window.addEventListener('mousemove', handleInteraction);

    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
      window.removeEventListener('mousemove', handleInteraction);
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, [isFullscreen]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
      if (e.key === 'ArrowLeft') prevSlide();
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentSlide, slides.length]);

  // Touch swipe navigation
  useEffect(() => {
    let touchStartX = 0;
    let touchEndX = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.changedTouches[0].screenX;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe();
    };

    const handleSwipe = () => {
      if (touchStartX - touchEndX > 50) nextSlide(); // Swipe left
      if (touchEndX - touchStartX > 50) prevSlide(); // Swipe right
    };

    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [currentSlide, slides.length]);


  const getSlideBackground = (type: string) => {
    switch (type) {
      case 'title':
        return 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))';
      case 'conclusion':
        return 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent) / 0.8))';
      default:
        return 'linear-gradient(135deg, hsl(var(--secondary)), hsl(var(--secondary) / 0.8))';
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-background to-secondary/20">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-lg text-muted-foreground">Generating presentation...</p>
        </div>
      </div>
    );
  }

  const slide = slides[currentSlide];
  const currentTheme = themes[theme];

  return (
    <div 
      ref={containerRef}
      className={cn(
        "relative h-screen w-screen overflow-hidden transition-all duration-500",
        "bg-gradient-to-br",
        currentTheme.bg
      )}
    >
      {/* Header */}
      <div className={cn(
        "absolute top-0 left-0 right-0 z-50 p-3 md:p-4 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent transition-all duration-300",
        isFullscreen && !showControls && "opacity-0 pointer-events-none"
      )}>
        {!isFullscreen && (
          <Button
            onClick={() => navigate("/")}
            variant="outline"
            size="sm"
            className="bg-background/90 backdrop-blur-sm hover:bg-background text-xs md:text-sm"
          >
            <ArrowLeft className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
            Indietro
          </Button>
        )}
        
        {isFullscreen && (
          <Button
            onClick={async () => {
              await document.exitFullscreen();
              setIsFullscreen(false);
            }}
            variant="outline"
            size="sm"
            className="bg-background/90 backdrop-blur-sm hover:bg-background text-xs md:text-sm"
          >
            <ArrowLeft className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
            Esci
          </Button>
        )}

        <div className="flex items-center gap-2">
          {/* Auto-play button */}
          <Button
            onClick={isAutoPlaying ? stopAutoPlay : startAutoPlay}
            variant="outline"
            size="sm"
            className={cn(
              "bg-background/90 backdrop-blur-sm hover:bg-background text-xs md:text-sm",
              isAutoPlaying && "bg-primary text-primary-foreground"
            )}
            title={isAutoPlaying ? "Ferma presentazione automatica" : "Avvia presentazione automatica"}
          >
            {isAutoPlaying ? (
              <>
                <Pause className="h-3 w-3 md:h-4 md:w-4 mr-1" />
                <span className="hidden sm:inline">Stop</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 md:h-4 md:w-4 mr-1" />
                <span className="hidden sm:inline">Auto</span>
              </>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="bg-background/90 backdrop-blur-sm hover:bg-background text-xs md:text-sm"
                title="Cambia tema"
              >
                <Palette className="h-3 w-3 md:h-4 md:w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme('aurora')}>🌈 Aurora</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('midnight')}>🌙 Midnight</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('ocean')}>🌊 Ocean</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('sunset')}>🌅 Sunset</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('forest')}>🌲 Forest</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('minimal')}>⚪ Minimal</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            onClick={toggleAudio}
            variant="outline"
            size="sm"
            disabled={isAutoPlaying || isLoadingAudio}
            className={cn(
              "bg-background/90 backdrop-blur-sm hover:bg-background text-xs md:text-sm",
              isPlayingAudio && "animate-pulse",
              isLoadingAudio && "opacity-70 cursor-wait"
            )}
            title={
              isLoadingAudio 
                ? "Caricamento audio..." 
                : isAudioEnabled 
                  ? "Disattiva audio" 
                  : "Attiva audio"
            }
          >
            {isLoadingAudio ? (
              <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" />
            ) : isAudioEnabled ? (
              <Volume2 className="h-3 w-3 md:h-4 md:w-4" />
            ) : (
              <VolumeX className="h-3 w-3 md:h-4 md:w-4" />
            )}
          </Button>

          <Button
            onClick={toggleFullscreen}
            variant="outline"
            size="sm"
            className="bg-background/90 backdrop-blur-sm hover:bg-background text-xs md:text-sm"
            title={isFullscreen ? "Esci da fullscreen" : "Fullscreen"}
          >
            <Maximize className="h-3 w-3 md:h-4 md:w-4" />
          </Button>
          
          <div className={cn("text-xs md:text-sm font-medium", currentTheme.text, "opacity-80")}>
            {currentSlide + 1} / {slides.length}
          </div>
        </div>
      </div>

      {/* Slide Content */}
      <div className="absolute inset-0 flex items-center justify-center p-2 md:p-12 pt-16 md:pt-20 pb-24 md:pb-32">
        <div 
          className={cn(
            "w-full h-full flex flex-col items-center justify-center text-center transition-all duration-700 overflow-y-auto",
            "animate-in fade-in slide-in-from-bottom-4",
            currentTheme.text
          )}
          key={currentSlide}
        >
          {/* Decorative elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className={cn(
              "absolute top-0 right-0 w-64 h-64 md:w-96 md:h-96 rounded-full blur-3xl opacity-20",
              currentTheme.accent
            )} />
            <div className={cn(
              "absolute bottom-0 left-0 w-64 h-64 md:w-96 md:h-96 rounded-full blur-3xl opacity-20",
              currentTheme.accent
            )} />
          </div>

          {/* Main content container with glass effect */}
          <div className={cn(
            "relative z-10 max-w-5xl w-full my-auto",
            slide?.type === 'title' ? "space-y-4 md:space-y-8" : "space-y-3 md:space-y-6",
            "backdrop-blur-sm bg-white/5 rounded-2xl md:rounded-3xl p-3 md:p-12",
            "border border-white/10 shadow-2xl",
            "max-h-full overflow-y-auto"
          )}>
            {/* Title with gradient */}
            <h1 className={cn(
              "font-bold leading-tight bg-gradient-to-r from-white via-white to-white/80 bg-clip-text text-transparent",
              slide?.type === 'title' ? "text-2xl md:text-7xl" : "text-xl md:text-5xl",
              "drop-shadow-lg px-2 md:px-0"
            )}>
              {slide?.title}
            </h1>

            {/* Content */}
            {slide?.type === 'title' ? (
              <p className={cn(
                "text-base md:text-3xl opacity-90 px-2 md:px-8 leading-relaxed",
                "transition-all duration-700",
                visibleContentItems.includes(0) ? "opacity-90 translate-y-0" : "opacity-0 translate-y-4"
              )}>
                {slide.content[0]}
              </p>
            ) : slide?.type === 'conclusion' ? (
              <div className="space-y-3 md:space-y-6">
                <div className={cn("w-12 md:w-20 h-1 mx-auto rounded-full", currentTheme.accent)} />
                {slide.content.map((item, idx) => (
                  <p
                    key={idx}
                    className={cn(
                      "text-sm md:text-2xl leading-relaxed px-2 md:px-12",
                      "transition-all duration-700 ease-out",
                      visibleContentItems.includes(idx) 
                        ? "opacity-100 translate-y-0" 
                        : "opacity-0 translate-y-8"
                    )}
                  >
                    {item}
                  </p>
                ))}
              </div>
            ) : (
              <div className="grid gap-2 md:gap-6">
                {slide?.content.map((item, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-start gap-2 md:gap-4 text-left p-2 md:p-6 rounded-xl md:rounded-2xl",
                      "bg-white/5 backdrop-blur-sm border border-white/10",
                      "hover:bg-white/10 transition-all duration-700 ease-out",
                      visibleContentItems.includes(idx)
                        ? "opacity-100 translate-x-0 scale-100"
                        : "opacity-0 -translate-x-12 scale-95"
                    )}
                  >
                    <div className={cn(
                      "flex-shrink-0 w-6 h-6 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-all duration-500",
                      currentTheme.accent,
                      "text-white font-bold text-xs md:text-base",
                      visibleContentItems.includes(idx) ? "scale-100 rotate-0" : "scale-0 -rotate-180"
                    )}>
                      {idx + 1}
                    </div>
                    <span className="text-xs md:text-xl leading-relaxed pt-0.5 md:pt-1">{item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className={cn(
        "absolute bottom-6 md:bottom-10 left-0 right-0 z-50 flex items-center justify-center gap-3 md:gap-4 px-4 transition-all duration-300",
        isFullscreen && !showControls && "opacity-0 pointer-events-none"
      )}>
        <Button
          onClick={prevSlide}
          disabled={currentSlide === 0 || isAutoPlaying}
          size="lg"
          className={cn(
            "h-14 w-14 md:h-16 md:w-16 rounded-full shadow-2xl",
            "backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20",
            "disabled:opacity-20 disabled:cursor-not-allowed",
            "transition-all duration-300 hover:scale-110",
            currentTheme.text
          )}
        >
          <ChevronLeft className="h-6 w-6 md:h-7 md:w-7" />
        </Button>
        
        <div className="backdrop-blur-md bg-white/10 border border-white/20 px-4 py-2 md:px-6 md:py-3 rounded-full">
          <span className={cn("text-sm md:text-base font-semibold", currentTheme.text)}>
            {currentSlide + 1} / {slides.length}
          </span>
        </div>
        
        <Button
          onClick={nextSlide}
          disabled={currentSlide === slides.length - 1 || isAutoPlaying}
          size="lg"
          className={cn(
            "h-14 w-14 md:h-16 md:w-16 rounded-full shadow-2xl",
            "backdrop-blur-md bg-white/10 hover:bg-white/20 border border-white/20",
            "disabled:opacity-20 disabled:cursor-not-allowed",
            "transition-all duration-300 hover:scale-110",
            currentTheme.text
          )}
        >
          <ChevronRight className="h-6 w-6 md:h-7 md:w-7" />
        </Button>
      </div>

      {/* Enhanced Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-2 bg-black/20 backdrop-blur-sm">
        <div 
          className={cn(
            "h-full transition-all duration-500 ease-out shadow-lg",
            currentTheme.accent
          )}
          style={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }}
        />
      </div>
    </div>
  );
};

export default Presentation;
