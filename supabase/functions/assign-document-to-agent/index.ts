import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AssignRequest {
  agentId: string;
  documentId: string;
  pipeline?: 'a' | 'b' | 'c';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { agentId, documentId, pipeline = 'a' }: AssignRequest = await req.json();

    console.log(`[assign-document-to-agent] Starting assignment: agent=${agentId}, document=${documentId}, pipeline=${pipeline}`);

    // 1. Verify document exists and is ready for assignment based on pipeline
    if (pipeline === 'b') {
      // Pipeline B: Check status='ready' in pipeline_b_documents
      const { data: document, error: docError } = await supabase
        .from('pipeline_b_documents')
        .select('id, file_name, status')
        .eq('id', documentId)
        .single();

      if (docError || !document) {
        console.error('[assign-document-to-agent] Pipeline B document not found:', docError);
        return new Response(
          JSON.stringify({ error: 'Pipeline B document not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (document.status !== 'ready') {
        console.error('[assign-document-to-agent] Pipeline B document not ready:', document.status);
        return new Response(
          JSON.stringify({ error: `Pipeline B document not ready (status: ${document.status})` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (pipeline === 'c') {
      // Pipeline C: Check status='ready' in pipeline_c_documents
      const { data: document, error: docError } = await supabase
        .from('pipeline_c_documents')
        .select('id, file_name, status')
        .eq('id', documentId)
        .single();

      if (docError || !document) {
        console.error('[assign-document-to-agent] Pipeline C document not found:', docError);
        return new Response(
          JSON.stringify({ error: 'Pipeline C document not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (document.status !== 'ready') {
        console.error('[assign-document-to-agent] Pipeline C document not ready:', document.status);
        return new Response(
          JSON.stringify({ error: `Pipeline C document not ready (status: ${document.status})` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Legacy: Check validation_status and processing_status
      const { data: document, error: docError } = await supabase
        .from('knowledge_documents')
        .select('id, file_name, processing_status, validation_status')
        .eq('id', documentId)
        .single();

      if (docError || !document) {
        console.error('[assign-document-to-agent] Document not found:', docError);
        return new Response(
          JSON.stringify({ error: 'Document not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (document.processing_status !== 'ready_for_assignment') {
        console.error('[assign-document-to-agent] Document not ready:', document.processing_status);
        return new Response(
          JSON.stringify({ error: `Document not ready (status: ${document.processing_status})` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (document.validation_status !== 'validated') {
        console.error('[assign-document-to-agent] Document not validated:', document.validation_status);
        return new Response(
          JSON.stringify({ error: `Document not validated (status: ${document.validation_status})` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 2. Handle Pipeline B assignment differently (no agent_document_links)
    if (pipeline === 'b') {
      console.log('[assign-document-to-agent] Pipeline B: Syncing directly to agent knowledge');
      
      // Invoke pipeline-b-sync-agent to sync chunks directly
      const { data: syncData, error: syncError } = await supabase.functions.invoke(
        'pipeline-b-sync-agent',
        {
          body: {
            agentId: agentId,
            documentIds: [documentId]
          }
        }
      );

      if (syncError) {
        console.error('[assign-document-to-agent] Pipeline B sync error:', syncError);
        return new Response(
          JSON.stringify({ error: 'Failed to sync Pipeline B document to agent' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[assign-document-to-agent] ✅ Pipeline B sync completed: ${syncData?.synced || 0} chunks`);

      return new Response(
        JSON.stringify({ 
          success: true,
          message: `Pipeline B document assigned successfully (${syncData?.synced || 0} chunks synced)`,
          synced: syncData?.synced || 0
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Handle Pipeline C assignment differently (no agent_document_links)
    if (pipeline === 'c') {
      console.log('[assign-document-to-agent] Pipeline C: Syncing directly to agent knowledge');
      
      // Invoke pipeline-c-sync-agent to sync chunks directly
      const { data: syncData, error: syncError } = await supabase.functions.invoke(
        'pipeline-c-sync-agent',
        {
          body: {
            agentId: agentId,
            documentIds: [documentId]
          }
        }
      );

      if (syncError) {
        console.error('[assign-document-to-agent] Pipeline C sync error:', syncError);
        return new Response(
          JSON.stringify({ error: 'Failed to sync Pipeline C document to agent' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[assign-document-to-agent] ✅ Pipeline C sync completed: ${syncData?.synced || 0} chunks`);

      return new Response(
        JSON.stringify({ 
          success: true,
          message: `Pipeline C document assigned successfully (${syncData?.synced || 0} chunks synced)`,
          synced: syncData?.synced || 0
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Legacy pipeline: Check if link already exists
    const { data: existingLink } = await supabase
      .from('agent_document_links')
      .select('id, sync_status')
      .eq('agent_id', agentId)
      .eq('document_id', documentId)
      .maybeSingle();

    if (existingLink) {
      console.log('[assign-document-to-agent] Link already exists:', existingLink.sync_status);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Document already assigned',
          linkId: existingLink.id,
          syncStatus: existingLink.sync_status
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Create the link with 'pending' status (legacy only)
    const { data: newLink, error: linkError } = await supabase
      .from('agent_document_links')
      .insert({
        agent_id: agentId,
        document_id: documentId,
        assignment_type: 'manual',
        sync_status: 'pending'
      })
      .select()
      .single();

    if (linkError) {
      console.error('[assign-document-to-agent] Failed to create link:', linkError);
      return new Response(
        JSON.stringify({ error: 'Failed to create assignment link' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[assign-document-to-agent] ✅ Assignment created successfully: ${newLink.id}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        linkId: newLink.id,
        syncStatus: 'pending',
        message: 'Document assigned successfully, synchronization will be processed in background'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[assign-document-to-agent] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
