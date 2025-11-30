import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BIG_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileName, fileData, fileSize, folder, source_type, storageUrl } = await req.json();

    if (!fileName || (!fileData && !storageUrl)) {
      return new Response(
        JSON.stringify({ error: 'fileName and either fileData or storageUrl are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[Pipeline A-Hybrid Ingest] Starting PDF ingestion: ${fileName}`);

    // Get file buffer: either from base64 or from storage URL
    let fileBuffer: Uint8Array;
    if (storageUrl) {
      console.log(`[Pipeline A-Hybrid Ingest] Fetching file from storage URL: ${storageUrl}`);
      const response = await fetch(storageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch from storage: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      fileBuffer = new Uint8Array(arrayBuffer);
      console.log(`[Pipeline A-Hybrid Ingest] Fetched ${fileBuffer.byteLength} bytes from storage`);
    } else {
      // Decode base64 to binary (legacy path)
      fileBuffer = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));
    }

    // Detect content type based on file extension or source_type
    const isPNG = fileName.toLowerCase().endsWith('.png') || source_type === 'image';
    const contentType = isPNG ? 'image/png' : 'application/pdf';
    
    console.log(`[Pipeline A-Hybrid Ingest] Uploading file as: ${contentType}`);

    // Upload to storage
    const filePath = `${crypto.randomUUID()}/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('pipeline-a-uploads')
      .upload(filePath, fileBuffer, {
        contentType,
        upsert: false
      });

    if (uploadError) {
      console.error('[Pipeline A-Hybrid Ingest] Storage upload failed:', uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Insert document record
    const { data: document, error: insertError } = await supabase
      .from('pipeline_a_hybrid_documents')
      .insert({
        file_name: fileName,
        file_path: filePath,
        storage_bucket: 'pipeline-a-uploads',
        file_size_bytes: fileSize,
        folder: folder || null,
        source_type: source_type || 'pdf',
        status: 'ingested',
        processing_metadata: {
          ingested_at: new Date().toISOString(),
          pipeline: 'a-hybrid',
        }
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Pipeline A-Hybrid Ingest] Database insert failed:', insertError);
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    console.log(`[Pipeline A-Hybrid Ingest] Document ingested: ${document.id}, size: ${fileBuffer.length} bytes`);

    // Check if file is large (> 10MB) - route to batch processing
    if (fileBuffer.length > BIG_FILE_THRESHOLD) {
      console.log(`[Pipeline A-Hybrid Ingest] ⚡ Large file detected (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB) - routing to batch processor`);
      
      try {
        EdgeRuntime.waitUntil(
          supabase.functions.invoke('split-pdf-into-batches', {
            body: { documentId: document.id }
          }).then(() => {
            console.log(`[Pipeline A-Hybrid Ingest] Triggered batch splitting for document ${document.id}`);
          })
        );
      } catch (invokeError) {
        console.warn('[Pipeline A-Hybrid Ingest] Failed to trigger batch splitting:', invokeError);
      }
    } else {
      // Standard processing for normal-sized files
      console.log(`[Pipeline A-Hybrid Ingest] Standard file (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB) - routing to direct processing`);
      
      try {
        EdgeRuntime.waitUntil(
          supabase.functions.invoke('pipeline-a-hybrid-process-chunks', {
            body: { documentId: document.id }
          }).then(() => {
            console.log(`[Pipeline A-Hybrid Ingest] Triggered processing for document ${document.id}`);
          })
        );
      } catch (invokeError) {
        console.warn('[Pipeline A-Hybrid Ingest] Failed to trigger processing (will be handled by cron):', invokeError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        documentId: document.id,
        fileName: document.file_name,
        message: 'Document ingested successfully, processing started'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline A-Hybrid Ingest] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
