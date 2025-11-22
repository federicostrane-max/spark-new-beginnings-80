import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function sanitizeText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let { text, fileName, fileSize, fileData } = await req.json();
    
    console.log('=== UPLOAD PDF TO POOL (ASYNC) ===');
    console.log(`File: ${fileName}, Size: ${text?.length || 0} chars`);

    if (!text || !fileName) {
      throw new Error('Missing required parameters: text or fileName');
    }

    text = sanitizeText(text);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check duplicate in database
    const { data: existingDoc } = await supabase
      .from('knowledge_documents')
      .select('id')
      .eq('file_name', fileName)
      .maybeSingle();

    if (existingDoc) {
      throw new Error(`Il documento "${fileName}" è già presente (ID: ${existingDoc.id})`);
    }

    // Upload to storage (delete first if exists, due to upsert bug)
    let storagePath = '';
    if (fileData) {
      const binaryString = atob(fileData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Check if file exists in storage and delete it
      const { data: existingFiles } = await supabase.storage
        .from('shared-pool-uploads')
        .list('', { search: fileName });

      if (existingFiles && existingFiles.length > 0) {
        console.log(`[STORAGE] Deleting existing file: ${fileName}`);
        await supabase.storage
          .from('shared-pool-uploads')
          .remove([fileName]);
      }

      // Now upload the new file
      const { error: uploadError } = await supabase.storage
        .from('shared-pool-uploads')
        .upload(fileName, bytes, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
      storagePath = `shared-pool-uploads/${fileName}`;
      console.log('[STORAGE] PDF uploaded successfully');
    }

    // Insert document in PENDING state - trigger will handle processing
    const { data: newDoc, error: insertError } = await supabase
      .from('knowledge_documents')
      .insert({
        file_name: fileName,
        file_path: storagePath || `pool/${fileName}`,
        file_size_bytes: fileSize || text.length,
        full_text: text,
        text_length: text.length,
        processing_status: 'pending_processing', // ✅ Trigger auto-processes
        validation_status: 'pending', // ✅ Correct initial state
        search_query: `Pool Upload: ${fileName}`,
        chunking_strategy: 'sliding_window'
      })
      .select('id')
      .single();

    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    console.log(`✓ Document ${newDoc.id} created - auto-processing will start via trigger`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId: newDoc.id,
        message: 'Upload successful. Processing starts automatically.',
        fileName
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('[ERROR]', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
