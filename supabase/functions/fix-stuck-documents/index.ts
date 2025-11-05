import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('[fix-stuck-documents] Starting to fix stuck documents...');

    // Find documents stuck in validating status with completed validation
    const { data: stuckDocs, error: fetchError } = await supabase
      .from('knowledge_documents')
      .select(`
        id,
        file_name,
        validation_status,
        processing_status,
        document_processing_cache!inner (
          validation_completed_at,
          processing_started_at
        )
      `)
      .eq('validation_status', 'validating')
      .not('document_processing_cache.validation_completed_at', 'is', null);

    if (fetchError) {
      console.error('[fix-stuck-documents] Error fetching stuck documents:', fetchError);
      throw fetchError;
    }

    console.log(`[fix-stuck-documents] Found ${stuckDocs?.length || 0} stuck documents`);

    if (!stuckDocs || stuckDocs.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No stuck documents found',
        fixed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let fixed = 0;
    let triggered = 0;

    for (const doc of stuckDocs) {
      console.log(`[fix-stuck-documents] Processing ${doc.file_name} (${doc.id.slice(0, 8)})`);

      // Update status to validated and ready for processing
      const { error: updateError } = await supabase
        .from('knowledge_documents')
        .update({
          validation_status: 'validated',
          processing_status: doc.processing_status === 'validating' ? 'pending_processing' : doc.processing_status,
          validation_reason: 'Document validation completed (recovered from stuck state)',
          validation_date: new Date().toISOString()
        })
        .eq('id', doc.id);

      if (updateError) {
        console.error(`[fix-stuck-documents] Failed to update ${doc.file_name}:`, updateError);
        continue;
      }

      fixed++;

      // If document is still pending processing, trigger it
      if (doc.processing_status === 'pending_processing' || doc.processing_status === 'validating') {
        console.log(`[fix-stuck-documents] Triggering processing for ${doc.file_name}`);
        
        supabase.functions.invoke('process-document', {
          body: { documentId: doc.id }
        }).then(() => {
          console.log(`[fix-stuck-documents] Processing triggered for ${doc.file_name}`);
        }).catch((err: Error) => {
          console.error(`[fix-stuck-documents] Failed to trigger processing for ${doc.file_name}:`, err);
        });
        
        triggered++;
      }
    }

    console.log(`[fix-stuck-documents] Fixed ${fixed} documents, triggered processing for ${triggered}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Fixed ${fixed} stuck documents`,
      fixed,
      triggered
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[fix-stuck-documents] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
