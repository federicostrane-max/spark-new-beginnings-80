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

    console.log('[cleanup] 🔍 Finding documents without chunks...');

    // Find all documents marked as ready but with no chunks
    const { data: documentsWithoutChunks, error: findError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .eq('processing_status', 'ready_for_assignment');

    if (findError) {
      throw findError;
    }

    const zombieDocuments = [];
    
    // Check each document for chunks
    for (const doc of documentsWithoutChunks || []) {
      const { count } = await supabase
        .from('agent_knowledge')
        .select('*', { count: 'exact', head: true })
        .eq('pool_document_id', doc.id)
        .is('agent_id', null);
      
      if (!count || count === 0) {
        zombieDocuments.push(doc);
      }
    }

    console.log(`[cleanup] Found ${zombieDocuments.length} zombie documents`);

    if (zombieDocuments.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          deleted: 0,
          message: 'No zombie documents found'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Delete zombie documents and their links
    const deletedIds = [];
    for (const doc of zombieDocuments) {
      console.log(`[cleanup] 🗑️ Deleting zombie document: ${doc.file_name}`);
      
      // Delete document links first (foreign key constraint)
      await supabase
        .from('agent_document_links')
        .delete()
        .eq('document_id', doc.id);
      
      // Delete from processing cache
      await supabase
        .from('document_processing_cache')
        .delete()
        .eq('document_id', doc.id);
      
      // Delete the document itself
      const { error: deleteError } = await supabase
        .from('knowledge_documents')
        .delete()
        .eq('id', doc.id);
      
      if (deleteError) {
        console.error(`[cleanup] ❌ Failed to delete ${doc.file_name}:`, deleteError);
      } else {
        deletedIds.push(doc.id);
        console.log(`[cleanup] ✅ Deleted ${doc.file_name}`);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        deleted: deletedIds.length,
        documents: zombieDocuments.map(d => d.file_name),
        message: `Successfully deleted ${deletedIds.length} zombie documents`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[cleanup] ❌ Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
