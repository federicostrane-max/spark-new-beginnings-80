import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      throw new Error('No file provided');
    }

    console.log(`📄 Pipeline B Ingest: ${file.name} (${file.size} bytes)`);

    // Upload to storage
    const fileName = `${Date.now()}_${file.name}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('knowledge-pdfs')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    console.log(`✓ Uploaded to storage: ${uploadData.path}`);

    // Create document record
    const { data: document, error: insertError } = await supabase
      .from('pipeline_b_documents')
      .insert({
        source_type: 'pdf',
        file_name: file.name,
        file_path: uploadData.path,
        storage_bucket: 'knowledge-pdfs',
        file_size_bytes: file.size,
        status: 'ingested',
      })
      .select()
      .single();

    if (insertError) throw insertError;

    console.log(`✓ Document record created: ${document.id}`);
    console.log(`⏳ Status: ingested (waiting for background processing)`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId: document.id,
        fileName: file.name,
        status: 'ingested',
        message: 'PDF uploaded successfully. Processing will begin automatically.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Pipeline B Ingest PDF error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});