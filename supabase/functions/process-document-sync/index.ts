import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncStats {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
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

    const { batchSize = 10 } = await req.json().catch(() => ({}));

    console.log(`[process-document-sync] Starting sync batch (max ${batchSize} documents)`);

    // 1. Get pending links
    const { data: pendingLinks, error: fetchError } = await supabase
      .from('agent_document_links')
      .select('id, agent_id, document_id, knowledge_documents(file_name)')
      .eq('sync_status', 'pending')
      .limit(batchSize);

    if (fetchError) {
      console.error('[process-document-sync] Failed to fetch pending links:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch pending documents' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!pendingLinks || pendingLinks.length === 0) {
      console.log('[process-document-sync] No pending documents found');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No pending documents to sync',
          stats: { total: 0, completed: 0, failed: 0, skipped: 0 }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[process-document-sync] Found ${pendingLinks.length} pending documents`);

    const stats: SyncStats = {
      total: pendingLinks.length,
      completed: 0,
      failed: 0,
      skipped: 0
    };

    // 2. Process each pending link
    for (const link of pendingLinks) {
      const fileName = (link.knowledge_documents as any)?.file_name || 'unknown';
      console.log(`[process-document-sync] Processing: ${fileName} (${link.document_id})`);

      try {
        // Check if chunks exist in shared pool
        const { count, error: countError } = await supabase
          .from('agent_knowledge')
          .select('*', { count: 'exact', head: true })
          .eq('pool_document_id', link.document_id)
          .is('agent_id', null)
          .eq('is_active', true);

        if (countError) {
          console.error(`[process-document-sync] Error counting chunks for ${fileName}:`, countError);
          stats.failed++;
          
          await supabase
            .from('agent_document_links')
            .update({
              sync_status: 'failed',
              sync_error: `Failed to verify chunks: ${countError.message}`
            })
            .eq('id', link.id);
          
          continue;
        }

        if (!count || count === 0) {
          console.warn(`[process-document-sync] No chunks found for ${fileName} - document needs reprocessing`);
          stats.failed++;
          
          await supabase
            .from('agent_document_links')
            .update({
              sync_status: 'failed',
              sync_error: 'Document has no chunks in shared pool. Reprocess the document at source.'
            })
            .eq('id', link.id);
          
          continue;
        }

        // Chunks exist - mark as completed
        console.log(`[process-document-sync] ✅ ${fileName}: ${count} chunks found, marking completed`);
        
        const { error: updateError } = await supabase
          .from('agent_document_links')
          .update({
            sync_status: 'completed',
            sync_completed_at: new Date().toISOString(),
            sync_error: null
          })
          .eq('id', link.id);

        if (updateError) {
          console.error(`[process-document-sync] Failed to update link status:`, updateError);
          stats.failed++;
        } else {
          stats.completed++;
        }

      } catch (error) {
        console.error(`[process-document-sync] Unexpected error processing ${fileName}:`, error);
        stats.failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        await supabase
          .from('agent_document_links')
          .update({
            sync_status: 'failed',
            sync_error: `Unexpected error: ${errorMessage}`
          })
          .eq('id', link.id);
      }
    }

    console.log(`[process-document-sync] ✅ Batch complete:`, stats);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Processed ${stats.total} documents`,
        stats
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[process-document-sync] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
