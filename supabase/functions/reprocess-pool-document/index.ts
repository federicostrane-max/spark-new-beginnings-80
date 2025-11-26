import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { documentId } = await req.json();

    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'documentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[reprocess-pool-document] Starting reprocessing for document: ${documentId}`);

    // 1. Get document info
    const { data: document, error: docError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path, processing_status')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      console.error('[reprocess-pool-document] Document not found:', docError);
      return new Response(
        JSON.stringify({ error: 'Document not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[reprocess-pool-document] Found document: ${document.file_name}`);

    // 2. Delete existing shared pool chunks for this document
    const { error: deleteError } = await supabase
      .from('agent_knowledge')
      .delete()
      .eq('pool_document_id', documentId)
      .is('agent_id', null);

    if (deleteError) {
      console.error('[reprocess-pool-document] Failed to delete old chunks:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Failed to delete old chunks' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[reprocess-pool-document] Deleted old chunks');

    // 3. Reset document status to pending_processing
    const { error: updateError } = await supabase
      .from('knowledge_documents')
      .update({
        processing_status: 'pending_processing',
        processed_at: null
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('[reprocess-pool-document] Failed to reset document status:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to reset document status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[reprocess-pool-document] Reset document to pending_processing');

    // 4. Invoke process-document to handle extraction and chunking
    const { data: processResult, error: processError } = await supabase.functions.invoke('process-document', {
      body: { documentId }
    });

    if (processError) {
      console.error('[reprocess-pool-document] Processing failed:', processError);
      return new Response(
        JSON.stringify({ 
          error: 'Document reprocessing failed',
          details: processError.message 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[reprocess-pool-document] ✅ Document reprocessed successfully`);

    // 5. Mark all failed links as pending so they can be retried
    const { error: linksError } = await supabase
      .from('agent_document_links')
      .update({ sync_status: 'pending', sync_error: null })
      .eq('document_id', documentId)
      .eq('sync_status', 'failed');

    if (linksError) {
      console.warn('[reprocess-pool-document] Failed to reset failed links:', linksError);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Document reprocessed successfully',
        documentId,
        fileName: document.file_name
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[reprocess-pool-document] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
