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

    console.log(`[extract-pdf-text] Attempting to download PDF: ${filePath}`);

    // Extract clean filename without 'shared-pool-uploads/' prefix
    const cleanFileName = filePath.replace(/^shared-pool-uploads\//, '');
    console.log(`[extract-pdf-text] Original file_path: ${filePath}`);
    console.log(`[extract-pdf-text] Clean filename: ${cleanFileName}`);

    // Try multiple storage buckets in priority order
    const bucketsToTry = [
      { name: 'shared-pool-uploads', path: cleanFileName },
      { name: 'knowledge-pdfs', path: filePath },
      { name: 'shared-pool-uploads', path: filePath },
      { name: 'agent-attachments', path: filePath }
    ];

    let pdfBlob = null;
    let successfulBucket = null;

    for (const bucket of bucketsToTry) {
      console.log(`[extract-pdf-text] Trying bucket: ${bucket.name}, path: ${bucket.path}`);
      
      const { data, error } = await supabase.storage
        .from(bucket.name)
        .download(bucket.path);
      
      if (!error && data) {
        pdfBlob = data;
        successfulBucket = bucket;
        console.log(`[extract-pdf-text] ✅ Download successful from ${bucket.name}`);
        break;
      }
      
      console.log(`[extract-pdf-text] ❌ Failed from ${bucket.name}:`, error?.message);
    }

    if (!pdfBlob || !successfulBucket) {
      const triedPaths = bucketsToTry.map(b => `${b.name}/${b.path}`).join(', ');
      console.log('[extract-pdf-text] ❌ File not found in any bucket, marking document as validation_failed');
      
      // Mark document as validation_failed if documentId is provided
      if (documentId) {
        await supabase
          .from('knowledge_documents')
          .update({
            processing_status: 'validation_failed',
            validation_status: 'rejected',
            validation_reason: `File not found in storage. Tried: ${triedPaths}`
          })
          .eq('id', documentId);
      }
      
      // Return 200 with success: false to avoid blocking workflow
      return new Response(
        JSON.stringify({ 
          success: false,
          error: `File not found in any storage bucket. Tried: ${triedPaths}`,
          text: ''
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`[extract-pdf-text] PDF downloaded from ${successfulBucket.name}, size: ${pdfBlob.size} bytes`);

    // Create a temporary signed URL for the PDF (valid for 5 minutes)
    console.log(`[extract-pdf-text] Creating signed URL from ${successfulBucket.name}...`);
    const { data: signedUrlData, error: signedUrlError } = await supabase
      .storage
      .from(successfulBucket.name)
      .createSignedUrl(successfulBucket.path, 300); // 300 seconds = 5 minutes

    if (signedUrlError || !signedUrlData?.signedUrl) {
      throw new Error(`Failed to create signed URL: ${signedUrlError?.message || 'Unknown error'}`);
    }

    console.log('[extract-pdf-text] Signed URL created, calling ocr-image...');

    // Call ocr-image function with the signed URL
    const { data: ocrData, error: ocrError } = await supabase.functions.invoke('ocr-image', {
      body: {
        imageUrl: signedUrlData.signedUrl,
        fileName: filePath.split('/').pop() || 'document.pdf'
      }
    });

    if (ocrError) {
      console.error('[extract-pdf-text] OCR failed:', ocrError);
      throw new Error(`OCR extraction failed: ${ocrError.message}`);
    }

    const extractedText = ocrData?.extractedText || '';

    if (!extractedText || extractedText.trim().length === 0) {
      console.warn('[extract-pdf-text] ⚠️ Warning: OCR returned empty or very short text');
      // Don't throw error - return what we have and let process-document handle it
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
