import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

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
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let fixed = 0;
    let deleted = 0;

    // Get all pending documents
    const { data: allPending } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path')
      .eq('processing_status', 'pending_processing');

    if (!allPending) {
      return new Response(JSON.stringify({ fixed: 0, deleted: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Process each document
    for (const doc of allPending) {
      // Check if has chunks
      const { data: chunks } = await supabase
        .from('agent_knowledge')
        .select('id')
        .eq('pool_document_id', doc.id)
        .limit(1);

      if (chunks && chunks.length > 0) {
        // Has chunks - just update status
        await supabase
          .from('knowledge_documents')
          .update({
            processing_status: 'ready_for_assignment',
            validation_status: 'validated'
          })
          .eq('id', doc.id);
        fixed++;
      } else {
        // No chunks - delete
        await supabase
          .from('agent_document_links')
          .delete()
          .eq('document_id', doc.id);
        
        await supabase
          .from('knowledge_documents')
          .delete()
          .eq('id', doc.id);
        deleted++;
      }
    }

    return new Response(
      JSON.stringify({ fixed, deleted, total: fixed + deleted }), 
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown' 
      }), 
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
