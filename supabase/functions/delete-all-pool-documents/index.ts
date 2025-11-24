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

    // Parse request body for document IDs
    const { documentIds } = await req.json();
    
    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'documentIds array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Deleting ${documentIds.length} documents`);

    // Process in batches of 100 to avoid URL limits
    const BATCH_SIZE = 100;
    let totalDeleted = 0;
    const allFilePaths: string[] = [];

    for (let i = 0; i < documentIds.length; i += BATCH_SIZE) {
      const batchIds = documentIds.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${i / BATCH_SIZE + 1}, IDs: ${batchIds.length}`);

      // 1. Delete agent_document_links
      const { error: linksError } = await supabase
        .from('agent_document_links')
        .delete()
        .in('document_id', batchIds);

      if (linksError) {
        console.error('Error deleting links:', linksError);
      }

      // 2. Delete agent_knowledge (shared pool chunks)
      const { error: chunksError } = await supabase
        .from('agent_knowledge')
        .delete()
        .in('pool_document_id', batchIds);

      if (chunksError) {
        console.error('Error deleting chunks:', chunksError);
      }

      // 3. Delete document_processing_cache
      const { error: cacheError } = await supabase
        .from('document_processing_cache')
        .delete()
        .in('document_id', batchIds);

      if (cacheError) {
        console.error('Error deleting cache:', cacheError);
      }

      // 4. Get file paths and delete documents
      const { data: documents, error: documentsError } = await supabase
        .from('knowledge_documents')
        .select('id, file_name')
        .in('id', batchIds);

      if (documentsError) {
        console.error('Error fetching documents:', documentsError);
      }

      if (documents && documents.length > 0) {
        // Collect file paths
        documents.forEach(doc => {
          if (doc.id && doc.file_name) {
            allFilePaths.push(`${doc.id}/${doc.file_name}`);
          }
        });

        // Delete from knowledge_documents table
        const { error: deleteError } = await supabase
          .from('knowledge_documents')
          .delete()
          .in('id', batchIds);

        if (deleteError) {
          console.error('Error deleting documents:', deleteError);
        } else {
          totalDeleted += documents.length;
        }
      }
    }

    // Delete storage files in batches of 100 (Supabase storage limit)
    let deletedFiles = 0;
    for (let i = 0; i < allFilePaths.length; i += 100) {
      const batch = allFilePaths.slice(i, i + 100);
      const { error: storageError } = await supabase.storage
        .from('knowledge-pdfs')
        .remove(batch);

      if (storageError) {
        console.error(`Storage deletion error (batch ${i}-${i + 100}):`, storageError);
      } else {
        deletedFiles += batch.length;
      }
    }

    console.log(`Deleted ${totalDeleted} documents, ${deletedFiles} files`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        deletedDocuments: totalDeleted,
        deletedFiles,
        requestedCount: documentIds.length
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
