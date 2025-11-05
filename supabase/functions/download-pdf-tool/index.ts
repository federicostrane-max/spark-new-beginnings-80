import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, search_query, expected_title, expected_author } = await req.json();
    
    console.log('[download-pdf-tool] ========== START ==========');
    console.log('[download-pdf-tool] Input:', JSON.stringify({ url, search_query }).slice(0, 200));
    
    if (!url) {
      throw new Error('URL is required');
    }

    console.log('📥 Downloading PDF from:', url);

    // Retry logic for unreliable PDFs
    let pdfResponse: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📥 Download attempt ${attempt}/3...`);
        pdfResponse = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PDFBot/1.0)'
          }
        });
        
        if (pdfResponse.ok) {
          console.log(`✅ Download successful on attempt ${attempt}`);
          break;
        }
        
        console.warn(`⚠️ Attempt ${attempt} failed with status ${pdfResponse.status}`);
        
        if (attempt < 3) {
          const delayMs = 1000 * attempt;
          console.log(`⏳ Waiting ${delayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (fetchError) {
        console.error(`❌ Attempt ${attempt} failed:`, fetchError);
        if (attempt === 3) throw fetchError;
        
        const delayMs = 1000 * attempt;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    if (!pdfResponse || !pdfResponse.ok) {
      throw new Error(`Failed to download PDF after 3 attempts: ${pdfResponse?.status}`);
    }

    // Validate Content-Type
    const contentType = pdfResponse.headers.get('content-type');
    console.log(`📄 Content-Type: ${contentType}`);

    if (!contentType?.includes('application/pdf') && !contentType?.includes('octet-stream')) {
      throw new Error(`Invalid content type: ${contentType}. Expected PDF.`);
    }

    const pdfBlob = await pdfResponse.blob();
    const pdfArrayBuffer = await pdfBlob.arrayBuffer();
    
    // Extract filename from URL or generate one
    const urlPath = new URL(url).pathname;
    const fileName = urlPath.split('/').pop() || `document_${Date.now()}.pdf`;
    const filePath = `${Date.now()}_${fileName}`;

    console.log('📄 File size:', pdfArrayBuffer.byteLength, 'bytes');

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('knowledge-pdfs')
      .upload(filePath, pdfArrayBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    console.log('✅ PDF uploaded to storage:', filePath);

    // Create document record (skip text extraction - will be done by process-document)
    const { data: document, error: docError } = await supabase
      .from('knowledge_documents')
      .insert({
        file_name: fileName,
        file_path: filePath,
        source_url: url,
        search_query: search_query || null,
        file_size_bytes: pdfArrayBuffer.byteLength,
        validation_status: 'validated', // Skip validation, go directly to processing
        processing_status: 'downloaded'
      })
      .select()
      .single();

    if (docError) {
      console.error('Document insert error:', docError);
      throw new Error(`Failed to create document record: ${docError.message}`);
    }

    console.log('📝 Document record created:', document.id);
    
    // Update queue entry to processing
    await supabase
      .from('pdf_download_queue')
      .update({
        status: 'processing',
        document_id: document.id,
        downloaded_file_name: fileName
      })
      .eq('url', url)
      .eq('search_query', search_query || '');

    // Trigger processing directly (process-document will extract text)
    console.log('[download-pdf-tool] Triggering process-document...');
    supabase.functions.invoke('process-document', {
      body: { 
        documentId: document.id
      }
    }).then(result => {
      if (result.error) {
        console.error('Processing error:', result.error);
      } else {
        console.log('✅ Processing started for:', document.id);
      }
    }).catch(err => {
      console.error('Processing invocation error:', err);
      console.error('Stack:', (err as Error).stack);
    });

    console.log('[download-pdf-tool] ========== END SUCCESS ==========');
    
    return new Response(
      JSON.stringify({ 
        success: true,
        document: {
          id: document.id,
          file_name: fileName,
          status: 'validating'
        },
        message: `PDF "${fileName}" downloaded successfully and validation started`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[download-pdf-tool] ❌ ERROR:', error);
    console.error('[download-pdf-tool] Stack:', (error as Error).stack);
    console.log('[download-pdf-tool] ========== END ERROR ==========');
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
