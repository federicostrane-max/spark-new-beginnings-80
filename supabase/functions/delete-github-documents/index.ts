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

    console.log('[delete-github-documents] Starting deletion of GitHub documents');

    // Step 1: Find all GitHub documents
    const { data: githubDocs, error: findError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .or('search_query.like.GitHub:%,folder.like.%GitHub%');

    if (findError) {
      console.error('[delete-github-documents] Error finding GitHub documents:', findError);
      throw findError;
    }

    console.log(`[delete-github-documents] Found ${githubDocs?.length || 0} GitHub documents`);

    if (!githubDocs || githubDocs.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No GitHub documents found',
          deletedDocuments: 0,
          deletedChunks: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const documentIds = githubDocs.map(doc => doc.id);

    // Step 2: Delete all chunks associated with these documents
    const { error: chunksError, count: chunksCount } = await supabase
      .from('agent_knowledge')
      .delete({ count: 'exact' })
      .in('pool_document_id', documentIds);

    if (chunksError) {
      console.error('[delete-github-documents] Error deleting chunks:', chunksError);
    } else {
      console.log(`[delete-github-documents] Deleted ${chunksCount || 0} chunks`);
    }

    // Step 3: Delete document links
    const { error: linksError } = await supabase
      .from('agent_document_links')
      .delete()
      .in('document_id', documentIds);

    if (linksError) {
      console.error('[delete-github-documents] Error deleting document links:', linksError);
    }

    // Step 4: Delete the documents themselves
    const { error: docsError, count: docsCount } = await supabase
      .from('knowledge_documents')
      .delete({ count: 'exact' })
      .in('id', documentIds);

    if (docsError) {
      console.error('[delete-github-documents] Error deleting documents:', docsError);
      throw docsError;
    }

    console.log(`[delete-github-documents] Deleted ${docsCount || 0} documents`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully deleted ${docsCount || 0} GitHub documents`,
        deletedDocuments: docsCount || 0,
        deletedChunks: chunksCount || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[delete-github-documents] Fatal error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
