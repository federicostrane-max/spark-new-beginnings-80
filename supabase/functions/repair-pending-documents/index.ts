import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const result = { 
      fixed: 0, 
      reprocessed: 0, 
      deleted: 0, 
      total: 0 
    };

    // Get docs with chunks
    const { data: chunks } = await supabase
      .from('agent_knowledge')
      .select('pool_document_id')
      .not('pool_document_id', 'is', null);
    
    const withChunks = [...new Set(chunks?.map(c => c.pool_document_id) || [])];

    // Fix docs with chunks
    const { data: docs1 } = await supabase
      .from('knowledge_documents')
      .select('*')
      .eq('processing_status', 'pending_processing')
      .in('id', withChunks);
    
    for (const doc of docs1 || []) {
      await supabase
        .from('knowledge_documents')
        .update({ 
          processing_status: 'ready_for_assignment',
          validation_status: 'validated'
        })
        .eq('id', doc.id);
      result.fixed++;
      result.total++;
    }

    // Handle docs without chunks
    const { data: docs2 } = await supabase
      .from('knowledge_documents')
      .select('*')
      .eq('processing_status', 'pending_processing')
      .not('id', 'in', withChunks.length > 0 ? `(${withChunks.map(id => `'${id}'`).join(',')})` : '()');
    
    for (const doc of docs2 || []) {
      // Try to find PDF
      let found = false;
      const paths = [doc.file_path, `shared-pool-uploads/${doc.file_name}`];
      
      for (const path of paths) {
        const { data } = await supabase.storage.from('knowledge-pdfs').download(path);
        if (data) {
          found = true;
          break;
        }
      }

      if (found) {
        await supabase.functions.invoke('process-document', { 
          body: { documentId: doc.id } 
        });
        result.reprocessed++;
      } else {
        await supabase.from('agent_document_links').delete().eq('document_id', doc.id);
        await supabase.from('knowledge_documents').delete().eq('id', doc.id);
        result.deleted++;
      }
      result.total++;
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
