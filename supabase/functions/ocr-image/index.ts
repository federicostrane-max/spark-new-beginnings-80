import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, fileName } = await req.json();
    
    if (!imageUrl) {
      throw new Error('No image URL provided');
    }

    const googleApiKey = Deno.env.get('GOOGLE_AI_STUDIO_API_KEY');
    if (!googleApiKey) {
      throw new Error('GOOGLE_AI_STUDIO_API_KEY not configured');
    }

    console.log('Performing OCR on image:', fileName);

    // Fetch image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

    // Call Google Vision API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Extract all text from this image. Return only the extracted text, nothing else." },
              {
                inline_data: {
                  mime_type: imageResponse.headers.get('content-type') || 'image/jpeg',
                  data: base64Image
                }
              }
            ]
          }]
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Google Vision API error:', error);
      throw new Error(`Google Vision API error: ${error}`);
    }

    const result = await response.json();
    const extractedText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log('OCR completed, extracted:', extractedText.substring(0, 100));

    return new Response(
      JSON.stringify({ extractedText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ocr-image:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
