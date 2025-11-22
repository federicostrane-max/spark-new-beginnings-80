import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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

    // Delete all chunks first
    const { error: chunksError } = await supabase
      .from('agent_knowledge')
      .delete()
      .is('agent_id', null);

    if (chunksError) {
      console.error('Error deleting chunks:', chunksError);
    }

    // Delete all documents
    const { data: documents, error: documentsError } = await supabase
      .from('knowledge_documents')
      .delete()
      .in('source_type', ['pdf', 'github'])
      .select('file_path');

    if (documentsError) {
      throw documentsError;
    }

    // Delete files from storage
    let deletedFiles = 0;
    if (documents && documents.length > 0) {
      for (const doc of documents) {
        if (doc.file_path) {
          const { error: storageError } = await supabase.storage
            .from('knowledge_documents')
            .remove([doc.file_path]);
          
          if (!storageError) {
            deletedFiles++;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        deletedDocuments: documents?.length || 0,
        deletedFiles 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
