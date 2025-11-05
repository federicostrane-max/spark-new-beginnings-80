import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractionRequest {
  documentId?: string;
  filePath?: string;
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
        .select('file_path, file_name')
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

    // Use OCR function to extract text (works for both text PDFs and scanned PDFs)
    console.log('[extract-pdf-text] Calling ocr-image for text extraction...');

    // Create FormData to send PDF
    const formData = new FormData();
    formData.append('file', pdfBlob, filePath.split('/').pop() || 'document.pdf');

    // Call ocr-image function
    const ocrResponse = await fetch(`${supabaseUrl}/functions/v1/ocr-image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: formData,
    });

    if (!ocrResponse.ok) {
      const errorText = await ocrResponse.text();
      console.error('[extract-pdf-text] OCR failed:', ocrResponse.status, errorText);
      throw new Error(`OCR extraction failed: ${ocrResponse.status} - ${errorText}`);
    }

    const ocrData = await ocrResponse.json();
    const extractedText = ocrData.text || '';

    if (!extractedText || extractedText.trim().length < 10) {
      throw new Error('Extracted text too short or empty. PDF might be corrupted or contain only images.');
    }

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
    
    // Provide more detailed error message
    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
      console.error('[extract-pdf-text] Error stack:', error.stack);
    }

    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        text: ''
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
