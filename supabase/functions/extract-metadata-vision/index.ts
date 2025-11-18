import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

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

    console.log(`[extract-metadata-vision] Processing file path: ${pdfFilePath}`);

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

    console.log(`[extract-metadata-vision] Using bucket: ${bucketName}, object path: ${objectPath}`);

    // Try to download PDF and get signed URL
    let signedUrl: string;
    try {
      const { data: signedData, error: signError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(objectPath, 300);

      if (signError) {
        console.error(`[extract-metadata-vision] Bucket ${bucketName} failed:`, signError);
        // Try alternative bucket
        const altBucket = bucketName === 'shared-pool-uploads' ? 'knowledge-pdfs' : 'shared-pool-uploads';
        console.log(`[extract-metadata-vision] Trying alternative bucket: ${altBucket}`);
        const { data: signedData2, error: signError2 } = await supabase.storage
          .from(altBucket)
          .createSignedUrl(objectPath, 300);

        if (signError2) {
          console.error(`[extract-metadata-vision] Alternative bucket ${altBucket} also failed:`, signError2);
          throw new Error(`Could not create signed URL from any bucket. First error: ${signError.message}, Second error: ${signError2.message}`);
        }
        signedUrl = signedData2.signedUrl;
        console.log(`[extract-metadata-vision] ✅ Got signed URL from alternative bucket ${altBucket}`);
      } else {
        signedUrl = signedData.signedUrl;
        console.log(`[extract-metadata-vision] ✅ Got signed URL from primary bucket ${bucketName}`);
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

    // Use ocr-image function to extract text from first 10 pages
    console.log('[extract-metadata-vision] Invoking ocr-image for first 10 pages...');
    const { data: ocrData, error: ocrError } = await supabase.functions.invoke('ocr-image', {
      body: {
        imageUrl: signedUrl,
        fileName: fileName || 'document.pdf',
        maxPages: 10  // Analyze first 10 pages instead of just 1
      }
    });

    if (ocrError || !ocrData?.extractedText) {
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

    const extractedText = ocrData.extractedText;
    console.log(`[extract-metadata-vision] OCR extracted ${extractedText.length} characters from first 10 pages`);

    // Now use AI to extract metadata from OCR text with vision-optimized prompt
    const metadataPrompt = `You are analyzing the FIRST 10 PAGES of an academic paper or technical document.
Extract the EXACT title and author(s) as they appear on the title page/cover page.

TITLE PATTERNS TO LOOK FOR:
1. Title page heading (usually largest text, centered, at top of page 1-3)
2. Text before "Abstract:", "Introduction:", "Chapter 1", "Preface"
3. Text in ALL CAPS or Title Case at the beginning
4. Prominent standalone text that looks like a book/paper title
5. If you see "Chapter 1" or "Introduction", look BEFORE it for the real title

AUTHOR PATTERNS TO LOOK FOR:
1. Names listed below the title (often on page 1-2)
2. Text near affiliations/universities/email addresses
3. Names in format "FirstName LastName" or "LastName, FirstName"
4. Multiple authors separated by commas, "and", or on separate lines

CRITICAL RULES:
1. EXCLUDE: "Abstract:", "Introduction:", "Chapter X", page numbers, headers/footers, URLs
2. Title should be 5-200 characters
3. Return confidence: "high" if clearly from title page, "medium" if uncertain, "low" if not found
4. Do NOT hallucinate or guess information
5. Focus on pages 1-3 as they typically contain title/authors

Document text from first 10 pages (prioritize earlier pages):
${extractedText.slice(0, 8000)}

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
