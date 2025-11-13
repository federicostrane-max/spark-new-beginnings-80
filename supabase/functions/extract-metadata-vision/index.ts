import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VisionExtractionRequest {
  documentId: string;
  filePath?: string;
  fileName?: string;
}

interface VisionExtractionResult {
  title: string | null;
  authors: string[] | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  success: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, filePath, fileName }: VisionExtractionRequest = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[extract-metadata-vision] Starting vision extraction for document ${documentId}`);

    // Get document info if filePath not provided
    let pdfFilePath = filePath;
    if (!pdfFilePath) {
      const { data: doc, error: docError } = await supabase
        .from('knowledge_documents')
        .select('file_path, file_name')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        throw new Error(`Document not found: ${documentId}`);
      }
      pdfFilePath = doc.file_path;
    }

    // Ensure pdfFilePath is defined
    if (!pdfFilePath) {
      throw new Error('PDF file path not found');
    }

    // Extract bucket and path (file_path might include bucket name)
    let bucketName = 'shared-pool-uploads';
    let objectPath = pdfFilePath;
    
    if (pdfFilePath.includes('/')) {
      const parts = pdfFilePath.split('/');
      if (parts[0] === 'shared-pool-uploads' || parts[0] === 'knowledge-pdfs') {
        bucketName = parts[0];
        objectPath = parts.slice(1).join('/');
      }
    }

    // Try to download PDF and get signed URL
    let signedUrl: string;
    try {
      const { data: signedData, error: signError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(objectPath, 300);

      if (signError) {
        // Try alternative bucket
        const altBucket = bucketName === 'shared-pool-uploads' ? 'knowledge-pdfs' : 'shared-pool-uploads';
        const { data: signedData2, error: signError2 } = await supabase.storage
          .from(altBucket)
          .createSignedUrl(objectPath, 300);

        if (signError2) {
          throw new Error('Could not create signed URL from any bucket');
        }
        signedUrl = signedData2.signedUrl;
      } else {
        signedUrl = signedData.signedUrl;
      }
    } catch (urlError) {
      console.error('[extract-metadata-vision] ❌ Failed to get signed URL:', urlError);
      return new Response(
        JSON.stringify({
          title: null,
          authors: null,
          confidence: 'low',
          reasoning: 'Could not access PDF file',
          success: false
        } as VisionExtractionResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[extract-metadata-vision] Using OCR-image function for vision extraction');

    // Use ocr-image function to extract text from first page
    const { data: ocrData, error: ocrError } = await supabase.functions.invoke('ocr-image', {
      body: {
        imageUrl: signedUrl,
        fileName: fileName || 'document.pdf'
      }
    });

    if (ocrError || !ocrData?.text) {
      console.error('[extract-metadata-vision] ❌ OCR extraction failed:', ocrError);
      return new Response(
        JSON.stringify({
          title: null,
          authors: null,
          confidence: 'low',
          reasoning: 'OCR extraction failed',
          success: false
        } as VisionExtractionResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[extract-metadata-vision] OCR extracted ${ocrData.text.length} characters`);

    // Now use AI to extract metadata from OCR text with vision-optimized prompt
    const metadataPrompt = `You are analyzing the FIRST PAGE of an academic paper or technical document.
Extract the EXACT title and author(s) as they appear on the title page/cover page.

CRITICAL RULES:
1. Title should be the main heading (usually largest text, centered, at top)
2. EXCLUDE these if they appear: "Abstract:", "Introduction:", "Chapter", page numbers, headers/footers
3. Authors are usually listed below the title (may include affiliations/universities)
4. If text seems to be from middle of document (starts with "Abstract:" or paragraph text), return null
5. Title should be 5-200 characters
6. Return confidence: "high" if clearly a title page, "medium" if uncertain, "low" if not a title page

Document text from first page:
${ocrData.text.slice(0, 2000)}

Return ONLY valid JSON:
{
  "title": "Exact title from document or null",
  "authors": ["Author 1", "Author 2"] or null,
  "confidence": "high" | "medium" | "low",
  "reasoning": "Brief explanation of extraction"
}`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: metadataPrompt }],
        response_format: { type: 'json_object' }
      })
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let content = aiData.choices[0].message.content;
    
    // Remove markdown code blocks if present
    content = content.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    
    const metadata = JSON.parse(content);

    console.log('[extract-metadata-vision] ✅ Vision extraction result:', metadata);

    // Validate and clean title
    let extractedTitle = metadata.title;
    if (!extractedTitle || extractedTitle === 'null' || extractedTitle === 'NULL') {
      console.log('[extract-metadata-vision] ⚠️ No valid title extracted, using filename fallback');
      extractedTitle = fileName ? fileName.replace(/\.pdf$/i, '').replace(/_/g, ' ') : null;
      metadata.confidence = 'low';
    }

    const result: VisionExtractionResult = {
      title: extractedTitle || null,
      authors: metadata.authors || null,
      confidence: metadata.confidence || 'medium',
      reasoning: metadata.reasoning || 'Extracted via vision analysis',
      success: extractedTitle !== null
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-metadata-vision] ❌ Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        title: null,
        authors: null,
        confidence: 'low',
        reasoning: `Error: ${errorMessage}`,
        success: false
      } as VisionExtractionResult),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
