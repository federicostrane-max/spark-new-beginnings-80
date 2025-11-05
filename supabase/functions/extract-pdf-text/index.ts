import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractionRequest {
  documentId?: string;
  filePath?: string; // Alternative: provide file path directly
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, filePath: providedFilePath }: ExtractionRequest = await req.json();

    console.log(`[extract-pdf-text] Starting for documentId: ${documentId || 'N/A'}, filePath: ${providedFilePath || 'N/A'}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let filePath = providedFilePath;

    // If documentId provided, get file_path from database
    if (documentId && !filePath) {
      const { data: doc, error: docError } = await supabase
        .from('knowledge_documents')
        .select('file_path')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        throw new Error(`Cannot find document: ${docError?.message || 'Not found'}`);
      }

      filePath = doc.file_path;
    }

    if (!filePath) {
      throw new Error('No file path provided or found');
    }

    console.log(`[extract-pdf-text] Downloading PDF from storage: ${filePath}`);

    // Download PDF from storage
    const { data: pdfBlob, error: downloadError } = await supabase
      .storage
      .from('knowledge-pdfs')
      .download(filePath);

    if (downloadError || !pdfBlob) {
      throw new Error(`Failed to download PDF: ${downloadError?.message || 'Unknown error'}`);
    }

    console.log(`[extract-pdf-text] PDF downloaded, size: ${pdfBlob.size} bytes`);

    // Convert to base64 for AI processing
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Convert to base64 in chunks to avoid memory issues
    const chunkSize = 1024 * 1024; // 1MB chunks
    let base64 = '';
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      base64 += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
    }

    console.log(`[extract-pdf-text] PDF converted to base64, length: ${base64.length}`);

    // Extract text using Lovable AI (Gemini Pro supports document understanding)
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log('[extract-pdf-text] Calling Lovable AI for text extraction...');

    // For large PDFs, use a more efficient approach: extract first N pages
    // Gemini Pro has better document understanding capabilities
    const extractionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash', // Fast model for extraction
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract ALL text content from this PDF document. Return ONLY the raw extracted text without any formatting, headers, or commentary. Include all paragraphs, maintaining the original structure.'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:application/pdf;base64,${base64.slice(0, 5000000)}` // Limit to ~5MB base64
              }
            }
          ]
        }],
        max_tokens: 16000 // Allow long responses
      })
    });

    if (!extractionResponse.ok) {
      const errorText = await extractionResponse.text();
      console.error('[extract-pdf-text] AI extraction failed:', extractionResponse.status, errorText);
      throw new Error(`AI extraction failed: ${extractionResponse.status}`);
    }

    const extractionData = await extractionResponse.json();
    const extractedText = extractionData.choices?.[0]?.message?.content || '';

    console.log(`[extract-pdf-text] ✅ Extraction successful: ${extractedText.length} characters`);

    return new Response(
      JSON.stringify({ 
        success: true,
        text: extractedText,
        length: extractedText.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-pdf-text] ❌ ERROR:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        text: ''
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
