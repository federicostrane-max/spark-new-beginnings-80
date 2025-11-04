import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { toast } from "sonner";
import "reveal.js/dist/reveal.css";
import "reveal.js/dist/theme/black.css";

interface PresentationSlide {
  title: string;
  content: string[];
  type: 'title' | 'content' | 'bullets' | 'conclusion';
}

const Presentation = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [slides, setSlides] = useState<PresentationSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const deckRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<any>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [showInstructions, setShowInstructions] = useState(true);

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

  useEffect(() => {
    if (slides.length > 0 && deckRef.current && !revealRef.current) {
      // Dynamic import for Reveal.js
      import('reveal.js').then(({ default: Reveal }) => {
        if (deckRef.current) {
          revealRef.current = new Reveal(deckRef.current, {
            embedded: false,
            hash: true,
            transition: 'slide',
            backgroundTransition: 'fade',
            controls: true,
            controlsLayout: 'bottom-right',
            controlsBackArrows: 'visible',
            progress: true,
            center: true,
            touch: true,
            loop: false,
            keyboard: true,
            overview: true,
            slideNumber: 'c/t',
            width: '100%',
            height: '100%',
            margin: 0.1,
            minScale: 0.2,
            maxScale: 2.0,
          });

          revealRef.current.initialize().then(() => {
            console.log('Reveal.js initialized with', slides.length, 'slides');
            revealRef.current.on('slidechanged', (event: any) => {
              setCurrentSlideIndex(event.indexh);
              console.log('Changed to slide', event.indexh);
            });
            // Hide instructions after 5 seconds
            setTimeout(() => setShowInstructions(false), 5000);
          });
        }
      }).catch(err => {
        console.error('Error loading Reveal.js:', err);
        toast.error('Failed to initialize presentation');
      });
    }

    return () => {
      if (revealRef.current) {
        revealRef.current.destroy();
        revealRef.current = null;
      }
    };
  }, [slides]);

  const nextSlide = () => {
    console.log('nextSlide called, current:', currentSlideIndex);
    revealRef.current?.next();
  };
  
  const prevSlide = () => {
    console.log('prevSlide called, current:', currentSlideIndex);
    revealRef.current?.prev();
  };

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

  return (
    <div className="relative h-screen w-screen bg-black overflow-hidden">
      {/* Header with Back Button */}
      <div className="absolute top-0 left-0 right-0 z-50 p-4 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
        <Button
          onClick={() => navigate("/")}
          variant="outline"
          size="sm"
          className="bg-background/90 backdrop-blur-sm hover:bg-background"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Chat
        </Button>
        
        <div className="text-white/80 text-sm font-medium">
          Slide {currentSlideIndex + 1} / {slides.length}
        </div>
      </div>

      {/* Instructions Overlay */}
      {showInstructions && (
        <div 
          className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in cursor-pointer"
          onClick={() => {
            console.log('Instructions dismissed');
            setShowInstructions(false);
          }}
        >
          <div className="bg-primary/90 backdrop-blur-sm text-primary-foreground px-6 py-3 rounded-full shadow-lg flex items-center gap-3">
            <Info className="h-5 w-5" />
            <span className="text-sm font-medium">
              Swipe or use arrows to navigate • Tap to dismiss
            </span>
          </div>
        </div>
      )}

      {/* Main Reveal.js Container - NO onClick to avoid blocking */}
      <div className="reveal" ref={deckRef}>
        <div className="slides">
          {slides.map((slide, index) => (
            <section
              key={index}
              data-background={getSlideBackground(slide.type)}
              data-transition="slide"
            >
              <h2 className="text-4xl md:text-5xl font-bold mb-8 px-4">{slide.title}</h2>
              {slide.type === 'title' ? (
                <p className="text-2xl md:text-3xl opacity-90 px-4">{slide.content[0]}</p>
              ) : (
                <ul className="text-left space-y-4 max-w-3xl mx-auto px-6">
                  {slide.content.map((item, itemIndex) => (
                    <li
                      key={itemIndex}
                      className="text-lg md:text-xl leading-relaxed"
                    >
                      • {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>

      {/* Custom Mobile Navigation Buttons - Always Visible */}
      <div className="absolute bottom-8 left-0 right-0 z-50 flex items-center justify-center gap-4">
        <Button
          onClick={(e) => {
            e.stopPropagation();
            console.log('Prev button clicked');
            prevSlide();
          }}
          disabled={currentSlideIndex === 0}
          size="lg"
          className="h-14 w-14 rounded-full bg-primary/90 hover:bg-primary shadow-lg disabled:opacity-50"
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
        
        <div className="bg-background/90 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-medium">
          {currentSlideIndex + 1} / {slides.length}
        </div>
        
        <Button
          onClick={(e) => {
            e.stopPropagation();
            console.log('Next button clicked');
            nextSlide();
          }}
          disabled={currentSlideIndex === slides.length - 1}
          size="lg"
          className="h-14 w-14 rounded-full bg-primary/90 hover:bg-primary shadow-lg disabled:opacity-50"
        >
          <ChevronRight className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
};

export default Presentation;
