import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

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

    const { data: pending } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .eq('processing_status', 'pending_processing');

    if (!pending) {
      return new Response(JSON.stringify({ fixed: 0, deleted: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    for (const doc of pending) {
      const { data: chunks } = await supabase
        .from('agent_knowledge')
        .select('id')
        .eq('pool_document_id', doc.id)
        .limit(1);

      if (chunks && chunks.length > 0) {
        await supabase
          .from('knowledge_documents')
          .update({
            processing_status: 'ready_for_assignment',
            validation_status: 'validated'
          })
          .eq('id', doc.id);
        fixed++;
      } else {
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
