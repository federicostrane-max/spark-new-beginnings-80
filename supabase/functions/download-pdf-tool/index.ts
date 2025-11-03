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
    const { url, search_query } = await req.json();
    
    if (!url) {
      throw new Error('URL is required');
    }

    console.log('📥 Downloading PDF from:', url);

    // Download the PDF
    const pdfResponse = await fetch(url);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF: ${pdfResponse.status} ${pdfResponse.statusText}`);
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

    // Create document record
    const { data: document, error: docError } = await supabase
      .from('knowledge_documents')
      .insert({
        file_name: fileName,
        file_path: filePath,
        source_url: url,
        search_query: search_query || null,
        file_size_bytes: pdfArrayBuffer.byteLength,
        validation_status: 'pending',
        processing_status: 'downloaded'
      })
      .select()
      .single();

    if (docError) {
      console.error('Document insert error:', docError);
      throw new Error(`Failed to create document record: ${docError.message}`);
    }

    console.log('📝 Document record created:', document.id);

    // Trigger validation (fire and forget - no await)
    supabase.functions.invoke('validate-document', {
      body: { documentId: document.id }
    }).then(result => {
      if (result.error) {
        console.error('Validation error:', result.error);
      } else {
        console.log('✅ Validation completed for:', document.id);
      }
    }).catch(err => {
      console.error('Validation invocation error:', err);
    });

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
    console.error('Error in download-pdf-tool:', error);
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
