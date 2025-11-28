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
    const { fileName, markdownContent, folder } = await req.json();

    if (!fileName || !markdownContent) {
      return new Response(
        JSON.stringify({ error: 'fileName and markdownContent are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Pipeline A-Hybrid Ingest Markdown] Ingesting:', fileName);

    // Create .md filename
    const mdFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
    const filePath = folder ? `${folder}/${mdFileName}` : mdFileName;

    // Upload markdown to storage
    const markdownBlob = new Blob([markdownContent], { type: 'text/markdown' });
    const { error: uploadError } = await supabase.storage
      .from('pipeline-a-uploads')
      .upload(filePath, markdownBlob, {
        contentType: 'text/markdown',
        upsert: false
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    console.log('[Pipeline A-Hybrid Ingest Markdown] Uploaded to storage:', filePath);

    // Insert document record with source_type='markdown'
    const { data: document, error: insertError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .insert({
        file_name: mdFileName,
        file_path: filePath,
        storage_bucket: 'pipeline-a-uploads',
        source_type: 'markdown',
        folder: folder || null,
        file_size_bytes: new Blob([markdownContent]).size,
        status: 'ingested'
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    console.log('[Pipeline A-Hybrid Ingest Markdown] Document created:', document.id);

    // Trigger processing (event-driven)
    try {
      supabase.functions.invoke('pipeline-a-hybrid-process-chunks', {
        body: { documentId: document.id }
      }).then(() => {
        console.log('[Pipeline A-Hybrid Ingest Markdown] Triggered processing for', document.id);
      });
    } catch (invokeError) {
      console.warn('[Pipeline A-Hybrid Ingest Markdown] Failed to trigger processing (will be handled by cron):', invokeError);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        documentId: document.id,
        fileName: mdFileName,
        message: 'Markdown ingested successfully'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline A-Hybrid Ingest Markdown] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
