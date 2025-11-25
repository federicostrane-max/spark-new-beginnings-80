import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileName, fileData, fileSize } = await req.json();

    if (!fileName || !fileData) {
      return new Response(
        JSON.stringify({ error: 'fileName and fileData are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Pipeline C Ingest] Processing PDF: ${fileName} (${fileSize} bytes)`);

    // Decode base64 to Uint8Array
    const pdfData = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));

    // Generate unique file path
    const timestamp = Date.now();
    const fileId = crypto.randomUUID();
    const filePath = `${fileId}/${fileName}`;

    console.log(`[Pipeline C Ingest] Uploading to storage: ${filePath}`);

    // Upload to storage bucket pipeline-c-uploads
    const { error: uploadError } = await supabase.storage
      .from('pipeline-c-uploads')
      .upload(filePath, pdfData, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('[Pipeline C Ingest] Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: `Storage upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline C Ingest] Creating document record`);

    // Insert document record with status='ingested'
    const { data: document, error: dbError } = await supabase
      .from('pipeline_c_documents')
      .insert({
        file_name: fileName,
        file_path: filePath,
        storage_bucket: 'pipeline-c-uploads',
        file_size_bytes: fileSize,
        status: 'ingested',
      })
      .select()
      .single();

    if (dbError) {
      console.error('[Pipeline C Ingest] Database error:', dbError);
      
      // Cleanup: delete uploaded file
      await supabase.storage.from('pipeline-c-uploads').remove([filePath]);
      
      return new Response(
        JSON.stringify({ error: `Database insert failed: ${dbError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline C Ingest] ✅ Document ingested successfully: ${document.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId: document.id,
        fileName: document.file_name,
        status: document.status,
        message: 'Document ingested successfully. Processing will begin shortly via cron.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline C Ingest] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
