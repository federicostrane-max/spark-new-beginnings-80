import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const [currentSlide, setCurrentSlide] = useState(0);

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

  const nextSlide = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

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

  return (
    <div className="relative h-screen w-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-hidden">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-50 p-3 md:p-4 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
        <Button
          onClick={() => navigate("/")}
          variant="outline"
          size="sm"
          className="bg-background/90 backdrop-blur-sm hover:bg-background text-xs md:text-sm"
        >
          <ArrowLeft className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
          Indietro
        </Button>
        
        <div className="text-white/80 text-xs md:text-sm font-medium">
          {currentSlide + 1} / {slides.length}
        </div>
      </div>

      {/* Slide Content */}
      <div className="absolute inset-0 flex items-center justify-center p-4 md:p-8">
        <div 
          className={cn(
            "w-full h-full flex flex-col items-center justify-center text-white text-center transition-all duration-500",
            "animate-in fade-in slide-in-from-bottom-4"
          )}
          key={currentSlide}
        >
          {/* Title */}
          <h1 className={cn(
            "font-bold mb-4 md:mb-8 px-2 md:px-4 leading-tight",
            slide?.type === 'title' ? "text-3xl md:text-6xl" : "text-2xl md:text-4xl"
          )}>
            {slide?.title}
          </h1>

          {/* Content */}
          {slide?.type === 'title' ? (
            <p className="text-lg md:text-2xl opacity-90 px-4 md:px-8 max-w-3xl">
              {slide.content[0]}
            </p>
          ) : (
            <ul className="space-y-3 md:space-y-4 max-w-2xl text-left px-4 md:px-8">
              {slide?.content.map((item, idx) => (
                <li
                  key={idx}
                  className="text-sm md:text-lg leading-relaxed flex items-start gap-2 md:gap-3 animate-in fade-in slide-in-from-left"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <span className="text-primary text-lg md:text-xl flex-shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="absolute bottom-4 md:bottom-8 left-0 right-0 z-50 flex items-center justify-center gap-3 md:gap-4 px-4">
        <Button
          onClick={prevSlide}
          disabled={currentSlide === 0}
          size="lg"
          className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-primary hover:bg-primary/90 shadow-lg disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-5 w-5 md:h-6 md:w-6" />
        </Button>
        
        <div className="bg-background/90 backdrop-blur-sm px-3 py-1.5 md:px-4 md:py-2 rounded-full text-xs md:text-sm font-medium">
          {currentSlide + 1} / {slides.length}
        </div>
        
        <Button
          onClick={nextSlide}
          disabled={currentSlide === slides.length - 1}
          size="lg"
          className="h-12 w-12 md:h-14 md:w-14 rounded-full bg-primary hover:bg-primary/90 shadow-lg disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-5 w-5 md:h-6 md:w-6" />
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
        <div 
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }}
        />
      </div>
    </div>
  );
};

export default Presentation;
