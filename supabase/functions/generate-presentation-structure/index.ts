import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PresentationSlide {
  title: string;
  content: string[];
  type: 'title' | 'content' | 'bullets' | 'conclusion';
}

function createFallbackStructure(text: string, title?: string): PresentationSlide[] {
  console.log('[generate-presentation-structure] Creating fallback structure');
  
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const slides: PresentationSlide[] = [];
  
  // Title slide
  slides.push({
    title: title || 'Presentation',
    content: ['Generated from document'],
    type: 'title'
  });
  
  // Split content into chunks for slides
  const chunkSize = Math.max(3, Math.min(5, Math.ceil(lines.length / 5)));
  for (let i = 0; i < lines.length && slides.length < 6; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize).slice(0, 5); // Max 5 points per slide
    if (chunk.length > 0) {
      slides.push({
        title: `Slide ${slides.length}`,
        content: chunk,
        type: 'bullets'
      });
    }
  }
  
  // Conclusion slide
  if (slides.length > 1) {
    slides[slides.length - 1].type = 'conclusion';
    slides[slides.length - 1].title = 'Summary';
  }
  
  return slides;
}

serve(async (req) => {
  console.log('[generate-presentation-structure] ========== START ==========');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, title } = await req.json();
    console.log('[generate-presentation-structure] Input text length:', text?.length);

    if (!text) {
      throw new Error('Text is required');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Use Lovable AI to analyze text and extract presentation structure with retry logic
    console.log('[generate-presentation-structure] Calling Lovable AI for structure extraction...');
    
    let aiResponse;
    let lastError;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `You are a presentation structure analyzer. Extract key concepts from text and organize them into presentation slides.
            
Return a JSON array of slides with this exact structure:
[
  {
    "title": "Main Title",
    "content": ["Subtitle or main point"],
    "type": "title"
  },
  {
    "title": "Slide Title",
    "content": ["Point 1", "Point 2", "Point 3"],
    "type": "bullets"
  },
  {
    "title": "Conclusion",
    "content": ["Summary point"],
    "type": "conclusion"
  }
]

Rules:
- Create 3-7 slides maximum
- Each slide should have a clear title
- Use "bullets" type for most slides with 2-5 points each
- Use "title" type only for the first slide
- Use "conclusion" type for the last slide
- Keep content concise and impactful
- Extract only the most important concepts`
              },
              {
                role: 'user',
                content: `Analyze this text and create a presentation structure:\n\nTitle: ${title || 'Presentation'}\n\nContent:\n${text}`
              }
            ],
            temperature: 0.3,
          }),
        });

        if (aiResponse.ok) {
          break; // Success, exit retry loop
        }

        const errorText = await aiResponse.text();
        console.error(`[generate-presentation-structure] AI API error (attempt ${attempt}/${maxRetries}):`, aiResponse.status, errorText);
        
        // Retry on 503, 429, or 500 errors
        if ([503, 429, 500].includes(aiResponse.status) && attempt < maxRetries) {
          const delayMs = attempt * 1000; // 1s, 2s, 3s
          console.log(`[generate-presentation-structure] Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        
        lastError = new Error(`AI API error: ${aiResponse.status}`);
      } catch (fetchError) {
        console.error(`[generate-presentation-structure] Fetch error (attempt ${attempt}/${maxRetries}):`, fetchError);
        lastError = fetchError;
        
        if (attempt < maxRetries) {
          const delayMs = attempt * 1000;
          console.log(`[generate-presentation-structure] Retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      }
    }

    // If all retries failed, use fallback
    if (!aiResponse || !aiResponse.ok) {
      console.warn('[generate-presentation-structure] AI API unavailable after retries, using fallback structure');
      const fallbackSlides = createFallbackStructure(text, title);
      return new Response(
        JSON.stringify({ slides: fallbackSlides }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices[0]?.message?.content;
    
    console.log('[generate-presentation-structure] AI response received, length:', aiContent?.length);

    // Parse AI response
    let slides: PresentationSlide[];
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        slides = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: create basic structure
        slides = [
          {
            title: title || 'Presentation',
            content: ['Generated from AI response'],
            type: 'title'
          },
          {
            title: 'Overview',
            content: text.split('\n').filter((line: string) => line.trim()).slice(0, 5),
            type: 'bullets'
          }
        ];
      }
    } catch (parseError) {
      console.error('[generate-presentation-structure] JSON parse error:', parseError);
      // Fallback structure
      slides = [
        {
          title: title || 'Presentation',
          content: ['Generated from text'],
          type: 'title'
        },
        {
          title: 'Content',
          content: text.split('\n').filter((line: string) => line.trim()).slice(0, 5),
          type: 'bullets'
        }
      ];
    }

    console.log('[generate-presentation-structure] Generated', slides.length, 'slides');
    console.log('[generate-presentation-structure] ========== END ==========');

    return new Response(
      JSON.stringify({ slides }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[generate-presentation-structure] ❌ ERROR:', error);
    console.error('[generate-presentation-structure] Stack:', error instanceof Error ? error.stack : 'N/A');
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        slides: [] 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
