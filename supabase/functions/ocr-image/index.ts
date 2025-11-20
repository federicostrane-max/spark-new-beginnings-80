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

    const googleApiKey = Deno.env.get('GOOGLE_AI_STUDIO_API_KEY');
    if (!googleApiKey) {
      throw new Error('GOOGLE_AI_STUDIO_API_KEY not configured');
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
    
    // Use chunked conversion for large files to avoid stack overflow
    console.log('[ocr-image] Converting to base64...');
    const base64Image = arrayBufferToBase64(imageBuffer);
    console.log('[ocr-image] Conversion complete');

    // Determine if it's a PDF or image
    const isPDF = fileName?.toLowerCase().endsWith('.pdf') || false;
    const mimeType = isPDF ? 'application/pdf' : (imageResponse.headers.get('content-type') || 'image/jpeg');
    const prompt = isPDF 
      ? `Extract ALL visible text from the first ${pagesToExtract} pages of this PDF document. Focus especially on: title, authors, publication info, chapter headings, and any bibliographic metadata. Return the text exactly as it appears, preserving formatting, line breaks, and structure. Do not add commentary.`
      : "Extract all text from this image. Return only the extracted text, nothing else.";
    
    console.log(`[ocr-image] Processing as: ${mimeType} (${pagesToExtract} pages)`);

    // Call Google Gemini API with higher quota model
    console.log('[ocr-image] Calling Google Gemini 2.0 Flash for OCR...');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
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
