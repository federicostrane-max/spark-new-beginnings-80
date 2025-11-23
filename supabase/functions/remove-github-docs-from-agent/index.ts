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

    const { agentId, folderPattern, deleteDocuments = false } = await req.json();

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: 'agentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[RemoveGitHubDocs] Starting cleanup for agent ${agentId}`);
    console.log(`[RemoveGitHubDocs] Folder pattern: ${folderPattern || 'all GitHub docs'}`);
    console.log(`[RemoveGitHubDocs] Delete documents: ${deleteDocuments}`);

    // Step 1: Find all GitHub documents for this agent
    let query = supabase
      .from('agent_document_links')
      .select(`
        id,
        document_id,
        knowledge_documents!inner(
          id,
          file_name,
          folder,
          search_query,
          source_url
        )
      `)
      .eq('agent_id', agentId);

    const { data: links, error: linksError } = await query;

    if (linksError) throw linksError;

    if (!links || links.length === 0) {
      console.log('[RemoveGitHubDocs] No document links found for this agent');
      return new Response(
        JSON.stringify({ 
          message: 'No document links found',
          linksRemoved: 0,
          documentsDeleted: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[RemoveGitHubDocs] Found ${links.length} total document links`);

    // Filter for GitHub documents
    const githubLinks = links.filter((link: any) => {
      const doc = link.knowledge_documents;
      if (!doc) return false;

      const isGitHub = doc.search_query?.startsWith('GitHub:') || 
                       doc.source_url?.includes('github.com');
      
      if (!isGitHub) return false;

      // If folder pattern specified, filter by it
      if (folderPattern) {
        return doc.folder?.includes(folderPattern);
      }

      return true;
    });

    console.log(`[RemoveGitHubDocs] Found ${githubLinks.length} GitHub document links to remove`);

    if (githubLinks.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No GitHub documents found matching criteria',
          linksRemoved: 0,
          documentsDeleted: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Remove the document links
    const linkIds = githubLinks.map((link: any) => link.id);
    const documentIds = githubLinks.map((link: any) => link.document_id);

    const { error: deleteLinksError } = await supabase
      .from('agent_document_links')
      .delete()
      .in('id', linkIds);

    if (deleteLinksError) throw deleteLinksError;

    console.log(`[RemoveGitHubDocs] Removed ${linkIds.length} document links`);

    let documentsDeleted = 0;

    // Step 3: Optionally delete the documents themselves
    if (deleteDocuments) {
      console.log(`[RemoveGitHubDocs] Deleting ${documentIds.length} documents from pool`);

      // Delete will cascade to agent_knowledge chunks via trigger
      const { error: deleteDocsError } = await supabase
        .from('knowledge_documents')
        .delete()
        .in('id', documentIds);

      if (deleteDocsError) {
        console.error('[RemoveGitHubDocs] Error deleting documents:', deleteDocsError);
      } else {
        documentsDeleted = documentIds.length;
        console.log(`[RemoveGitHubDocs] Deleted ${documentsDeleted} documents`);
      }
    }

    const result = {
      message: 'GitHub documents removed from agent successfully',
      linksRemoved: linkIds.length,
      documentsDeleted,
      removedDocuments: githubLinks.map((link: any) => ({
        fileName: link.knowledge_documents?.file_name,
        folder: link.knowledge_documents?.folder
      }))
    };

    console.log('[RemoveGitHubDocs] Cleanup completed:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[RemoveGitHubDocs] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});