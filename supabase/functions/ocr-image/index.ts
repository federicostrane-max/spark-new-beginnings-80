import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to convert ArrayBuffer to base64 in chunks to avoid stack overflow
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192; // Process in 8KB chunks to avoid call stack limit
  let binary = '';
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, fileName, maxPages } = await req.json();
    
    if (!imageUrl) {
      throw new Error('No image URL provided');
    }
    
    const pagesToExtract = maxPages || 1; // Default to 1 page if not specified

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log('[ocr-image] Processing file:', fileName || imageUrl);

    // Fetch image/PDF and convert to base64
    console.log('[ocr-image] Fetching from URL...');
    const imageResponse = await fetch(imageUrl);
    
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch file: ${imageResponse.status} ${imageResponse.statusText}`);
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const fileSizeMB = (imageBuffer.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`[ocr-image] File downloaded: ${fileSizeMB} MB`);
    
    // Determine if it's a PDF or image
    const isPDF = fileName?.toLowerCase().endsWith('.pdf') || false;
    console.log(`[ocr-image] Processing as: ${isPDF ? 'PDF' : 'Image'} (${pagesToExtract} pages)`);

    let extractedText = '';

    if (isPDF) {
      // Use Google Cloud Vision for PDF OCR
      console.log('[ocr-image] Using Google Cloud Vision for PDF OCR...');
      const visionApiKey = Deno.env.get('GOOGLE_CLOUD_VISION_API_KEY');
      if (!visionApiKey) {
        throw new Error('GOOGLE_CLOUD_VISION_API_KEY not configured');
      }

      const base64PDF = arrayBufferToBase64(imageBuffer);

      const response = await fetch(
        `https://vision.googleapis.com/v1/files:annotate?key=${visionApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              inputConfig: {
                content: base64PDF,
                mimeType: 'application/pdf'
              },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              pages: Array.from({ length: pagesToExtract }, (_, i) => i + 1)
            }]
          })
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('Google Cloud Vision error:', error);
        throw new Error(`Google Cloud Vision error: ${error}`);
      }

      const result = await response.json();
      console.log('[ocr-image] Cloud Vision response received');

      // Extract text from all pages
      const responses = result.responses?.[0]?.responses || [];
      const pageTexts: string[] = [];
      
      for (const pageResponse of responses) {
        const pageText = pageResponse.fullTextAnnotation?.text || '';
        if (pageText) {
          pageTexts.push(pageText);
        }
      }

      extractedText = pageTexts.join('\n\n');
      console.log(`[ocr-image] Extracted ${extractedText.length} characters from ${pageTexts.length} pages`);

    } else {
      // Use Lovable AI Gateway for image OCR
      console.log('[ocr-image] Using Lovable AI Gateway (Gemini 2.5 Flash) for image OCR...');
      const prompt = "Extract all text from this image. Return only the extracted text, nothing else.";

      const response = await fetch(
        'https://ai.gateway.lovable.dev/v1/chat/completions',
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${lovableApiKey}`
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl  // Use direct URL for images
                  }
                }
              ]
            }]
          })
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('Lovable AI Gateway error:', error);
        throw new Error(`Lovable AI Gateway error: ${error}`);
      }

      const result = await response.json();
      extractedText = result.choices?.[0]?.message?.content || '';
    }

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
