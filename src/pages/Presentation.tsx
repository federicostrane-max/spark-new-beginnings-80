import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
        import('reveal.js/dist/reveal.css');
        import('reveal.js/dist/theme/black.css');
        
        if (deckRef.current) {
          revealRef.current = new Reveal(deckRef.current, {
            embedded: false,
            hash: true,
            transition: 'slide',
            backgroundTransition: 'fade',
            controls: true,
            progress: true,
            center: true,
            touch: true,
            loop: false,
            keyboard: true,
            overview: true,
          });

          revealRef.current.initialize().then(() => {
            revealRef.current.on('slidechanged', (event: any) => {
              setCurrentSlideIndex(event.indexh);
            });
          });
        }
      });
    }

    return () => {
      if (revealRef.current) {
        revealRef.current.destroy();
        revealRef.current = null;
      }
    };
  }, [slides]);

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
    <div className="relative h-screen w-screen bg-black">
      <Button
        onClick={() => navigate("/")}
        variant="outline"
        size="sm"
        className="absolute top-4 left-4 z-50 bg-background/90 backdrop-blur-sm hover:bg-background"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Chat
      </Button>

      <div className="reveal" ref={deckRef}>
        <div className="slides">
          {slides.map((slide, index) => (
            <section
              key={index}
              data-background={getSlideBackground(slide.type)}
              data-transition="slide"
            >
              <h2 className="text-4xl font-bold mb-8">{slide.title}</h2>
              {slide.type === 'title' ? (
                <p className="text-2xl opacity-90">{slide.content[0]}</p>
              ) : (
                <ul className="text-left space-y-4 max-w-3xl mx-auto">
                  {slide.content.map((item, itemIndex) => (
                    <li
                      key={itemIndex}
                      className="text-xl fragment fade-in-then-semi-out"
                      data-fragment-index={itemIndex}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Presentation;
