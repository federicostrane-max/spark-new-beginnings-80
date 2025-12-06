import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractTextWithClaudeVision, chunkOCROutput } from "../_shared/claudeVisionOCR.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const { documentId } = await req.json();

    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'documentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[TestClaudeOCR] Starting direct test for document: ${documentId}`);

    // 1. Get document info
    const { data: docData, error: docError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .select('file_name, file_path, storage_bucket, page_count')
      .eq('id', documentId)
      .single();

    if (docError || !docData) {
      return new Response(
        JSON.stringify({ error: `Document not found: ${docError?.message}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[TestClaudeOCR] Document: ${docData.file_name}`);
    console.log(`[TestClaudeOCR] Storage: ${docData.storage_bucket}/${docData.file_path}`);

    // 2. Download PDF
    const { data: pdfData, error: downloadError } = await supabase.storage
      .from(docData.storage_bucket || 'pipeline-a-hybrid-uploads')
      .download(docData.file_path);

    if (downloadError || !pdfData) {
      return new Response(
        JSON.stringify({ error: `Failed to download PDF: ${downloadError?.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pdfBuffer = new Uint8Array(await pdfData.arrayBuffer());
    console.log(`[TestClaudeOCR] Downloaded PDF: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // 3. Run Claude Vision OCR (this will use pdf-lib splitting if > 100 pages)
    console.log(`[TestClaudeOCR] 🔍 Running Claude Vision OCR...`);
    const ocrResult = await extractTextWithClaudeVision(pdfBuffer, {
      anthropicKey,
      fileName: docData.file_name
    });

    console.log(`[TestClaudeOCR] OCR Result:`, {
      success: ocrResult.success,
      textLength: ocrResult.text.length,
      pageCount: ocrResult.pageCount,
      processingTimeMs: ocrResult.processingTimeMs,
      errorMessage: ocrResult.errorMessage
    });

    if (!ocrResult.success) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: ocrResult.errorMessage,
          processingTimeMs: ocrResult.processingTimeMs
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Chunk the OCR output
    const chunks = chunkOCROutput(ocrResult.text);
    console.log(`[TestClaudeOCR] Created ${chunks.length} chunks from OCR output`);

    // 5. Preview first 500 chars of text
    const textPreview = ocrResult.text.substring(0, 500);

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        fileName: docData.file_name,
        pdfSizeMB: (pdfBuffer.length / 1024 / 1024).toFixed(2),
        ocrResult: {
          pageCount: ocrResult.pageCount,
          textLength: ocrResult.text.length,
          processingTimeMs: ocrResult.processingTimeMs,
          chunksCreated: chunks.length
        },
        textPreview,
        totalTimeMs: Date.now() - startTime
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[TestClaudeOCR] Error:`, error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : String(error),
        totalTimeMs: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
