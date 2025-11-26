import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: any;

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
        JSON.stringify({ error: 'Missing fileName or fileData' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline A Ingest] Processing: ${fileName}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Decode base64 file data
    const decodedData = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));

    // Generate unique file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const randomId = crypto.randomUUID();
    const filePath = `${randomId}/${timestamp}_${fileName}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('pipeline-a-uploads')
      .upload(filePath, decodedData, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('[Pipeline A Ingest] Storage upload failed:', uploadError);
      return new Response(
        JSON.stringify({ error: `Storage upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert document record
    const { data: document, error: dbError } = await supabase
      .from('pipeline_a_documents')
      .insert({
        file_name: fileName,
        file_path: filePath,
        storage_bucket: 'pipeline-a-uploads',
        file_size_bytes: fileSize,
        status: 'ingested',
      })
      .select()
      .single();

    if (dbError) {
      console.error('[Pipeline A Ingest] Database insert failed:', dbError);
      
      // Cleanup: delete uploaded file
      await supabase.storage.from('pipeline-a-uploads').remove([filePath]);

      return new Response(
        JSON.stringify({ error: `Database insert failed: ${dbError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline A Ingest] Document created: ${document.id}`);

    // Trigger pipeline-a-process-chunks (event-driven)
    try {
      EdgeRuntime.waitUntil(
        supabase.functions.invoke('pipeline-a-process-chunks', {
          body: { documentId: document.id },
        })
      );
      console.log(`[Pipeline A Ingest] Triggered processing for document ${document.id}`);
    } catch (triggerError) {
      console.warn('[Pipeline A Ingest] Failed to trigger processing:', triggerError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        documentId: document.id,
        fileName: fileName,
        status: 'ingested',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Pipeline A Ingest] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
