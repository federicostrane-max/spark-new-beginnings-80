import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📥 Pipeline B Ingest PDF - Request received');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse JSON body
    const body = await req.json();
    const { fileName, fileData, fileSize } = body;

    if (!fileName || !fileData) {
      console.error('❌ Missing fileName or fileData');
      throw new Error('No file provided');
    }

    console.log(`📄 File received: ${fileName} (${fileSize} bytes)`);

    // Decode base64 to Uint8Array
    const binaryString = atob(fileData);
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }

    // Upload to storage
    const storagePath = `${Date.now()}_${fileName}`;
    console.log(`⬆️ Uploading to storage: ${storagePath}`);
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('knowledge-pdfs')
      .upload(storagePath, uint8Array, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      console.error('❌ Storage upload error:', uploadError);
      throw uploadError;
    }

    console.log(`✓ Uploaded to storage: ${uploadData.path}`);

    // Create document record
    const { data: document, error: insertError } = await supabase
      .from('pipeline_b_documents')
      .insert({
        source_type: 'pdf',
        file_name: fileName,
        file_path: uploadData.path,
        storage_bucket: 'knowledge-pdfs',
        file_size_bytes: fileSize,
        status: 'ingested',
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Database insert error:', insertError);
      throw insertError;
    }

    console.log(`✓ Document record created: ${document.id}`);
    console.log(`⏳ Status: ingested (waiting for background processing)`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId: document.id,
        fileName: fileName,
        status: 'ingested',
        message: 'PDF uploaded successfully. Processing will begin automatically.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Pipeline B Ingest PDF error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});