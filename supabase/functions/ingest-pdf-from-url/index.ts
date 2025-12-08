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
    const { url, fileName, folder } = await req.json();

    if (!url || !fileName) {
      return new Response(
        JSON.stringify({ error: 'url and fileName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Ingest PDF from URL] Downloading: ${url}`);
    
    // Download the PDF
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LovableBot/1.0)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);
    console.log(`[Ingest PDF from URL] Downloaded ${fileBuffer.byteLength} bytes`);

    // Upload to storage
    const filePath = `${crypto.randomUUID()}/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('pipeline-a-uploads')
      .upload(filePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }
    
    console.log(`[Ingest PDF from URL] Uploaded to storage: ${filePath}`);

    // Insert document record
    const { data: document, error: insertError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .insert({
        file_name: fileName,
        file_path: filePath,
        storage_bucket: 'pipeline-a-uploads',
        file_size_bytes: fileBuffer.byteLength,
        folder: folder || 'uploads',
        source_type: 'pdf',
        status: 'ingested',
        extraction_mode: 'auto',
        extraction_attempts: 0
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create document record: ${insertError.message}`);
    }

    console.log(`[Ingest PDF from URL] Created document record: ${document.id}`);

    // Trigger batch splitting via event-driven invocation
    const triggerBatchSplit = async () => {
      try {
        console.log(`[Ingest PDF from URL] Triggering batch split for ${document.id}`);
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        
        await fetch(`${supabaseUrl}/functions/v1/split-pdf-into-batches`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${anonKey}`
          },
          body: JSON.stringify({ documentId: document.id })
        });
      } catch (err) {
        console.error(`[Ingest PDF from URL] Failed to trigger batch split:`, err);
      }
    };

    (globalThis as any).EdgeRuntime?.waitUntil?.(triggerBatchSplit()) || triggerBatchSplit();

    return new Response(JSON.stringify({
      success: true,
      documentId: document.id,
      fileName,
      filePath,
      fileSize: fileBuffer.byteLength
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Ingest PDF from URL] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
