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

    // Initialize Supabase early for duplicate check
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // STEP 1: Check for duplicates BEFORE downloading
    console.log('🔍 Checking for duplicate PDF...');
    const { data: existingDoc, error: checkError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .eq('source_url', url)
      .maybeSingle();

    if (checkError) {
      console.warn('⚠️ Error checking for duplicates:', checkError);
    }

    if (existingDoc) {
      console.log(`✅ PDF already exists in knowledge base: ${existingDoc.file_name}`);
      
      // Update queue entry
      await supabase
        .from('pdf_download_queue')
        .update({
          status: 'completed',
          document_id: existingDoc.id,
          downloaded_file_name: existingDoc.file_name,
          completed_at: new Date().toISOString()
        })
        .eq('url', url)
        .eq('search_query', search_query || '');

      return new Response(
        JSON.stringify({ 
          success: true,
          document: {
            id: existingDoc.id,
            file_name: existingDoc.file_name,
            status: 'already_exists'
          },
          message: `PDF "${existingDoc.file_name}" is already in your knowledge base (skipped duplicate download)`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('📥 Downloading PDF from:', url);

    // User-Agent rotation to bypass 403 errors
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ];

    // Retry logic with User-Agent rotation
    let pdfResponse: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const userAgent = userAgents[attempt - 1] || userAgents[0];
        console.log(`📥 Download attempt ${attempt}/3 with User-Agent: ${userAgent.slice(0, 50)}...`);
        
        pdfResponse = await fetch(url, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/pdf,application/octet-stream,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': new URL(url).origin
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
      const status = pdfResponse?.status;
      let errorMsg = `Failed to download PDF after 3 attempts`;
      
      if (status === 403) {
        errorMsg = `PDF requires authentication or blocks automated access (HTTP 403). The source website is preventing downloads.`;
      } else if (status === 404) {
        errorMsg = `PDF not found at this URL (HTTP 404). The link may be broken or expired.`;
      } else if (status === 401) {
        errorMsg = `PDF requires login credentials (HTTP 401). Cannot download protected content.`;
      } else if (status) {
        errorMsg = `${errorMsg} (HTTP ${status})`;
      }
      
      throw new Error(errorMsg);
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

    // Upload to storage (Supabase client already initialized at top)
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
      
      // Provide user-friendly error for duplicate filename
      if (docError.code === '23505' && docError.message.includes('unique_file_name')) {
        throw new Error(`A PDF with filename "${fileName}" already exists in your knowledge base. This PDF was downloaded from a different URL but has the same filename.`);
      }
      
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
