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

    console.log(`[DELETE] Starting deletion of ${documentIds.length} documents`);

    // Use smaller batches (50) to avoid database timeouts on heavy operations
    const BATCH_SIZE = 50;
    let totalDeleted = 0;
    const allFilePaths: string[] = [];

    for (let i = 0; i < documentIds.length; i += BATCH_SIZE) {
      const batchIds = documentIds.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[BATCH ${batchNum}] Processing ${batchIds.length} documents`);

      // 1. Get file paths BEFORE deleting documents
      const { data: documents, error: fetchError } = await supabase
        .from('knowledge_documents')
        .select('id, file_name')
        .in('id', batchIds);

      if (fetchError) {
        console.error(`[BATCH ${batchNum}] Error fetching documents:`, fetchError);
        throw fetchError;
      }

      if (documents && documents.length > 0) {
        documents.forEach(doc => {
          if (doc.id && doc.file_name) {
            allFilePaths.push(`${doc.id}/${doc.file_name}`);
          }
        });
        console.log(`[BATCH ${batchNum}] Found ${documents.length} documents with file paths`);
      }

      // 2. Delete agent_document_links
      const { error: linksError } = await supabase
        .from('agent_document_links')
        .delete()
        .in('document_id', batchIds);

      if (linksError) {
        console.error(`[BATCH ${batchNum}] Error deleting links:`, linksError);
      } else {
        console.log(`[BATCH ${batchNum}] Deleted agent_document_links`);
      }

      // 3. Delete agent_knowledge (shared pool chunks) - may timeout if many chunks
      const { error: chunksError } = await supabase
        .from('agent_knowledge')
        .delete()
        .in('pool_document_id', batchIds);

      if (chunksError) {
        console.error(`[BATCH ${batchNum}] Error deleting chunks:`, chunksError);
        // Don't throw - continue with other deletions
      } else {
        console.log(`[BATCH ${batchNum}] Deleted agent_knowledge chunks`);
      }

      // 4. Delete document_processing_cache
      const { error: cacheError } = await supabase
        .from('document_processing_cache')
        .delete()
        .in('document_id', batchIds);

      if (cacheError) {
        console.error(`[BATCH ${batchNum}] Error deleting cache:`, cacheError);
      } else {
        console.log(`[BATCH ${batchNum}] Deleted processing cache`);
      }

      // 5. Delete from knowledge_documents table
      const { error: deleteError } = await supabase
        .from('knowledge_documents')
        .delete()
        .in('id', batchIds);

      if (deleteError) {
        console.error(`[BATCH ${batchNum}] Error deleting documents:`, deleteError);
        throw deleteError;
      } else {
        totalDeleted += batchIds.length;
        console.log(`[BATCH ${batchNum}] Deleted ${batchIds.length} documents from DB`);
      }
    }

    // Delete storage files in batches of 100 (Supabase storage limit)
    let deletedFiles = 0;
    console.log(`[STORAGE] Deleting ${allFilePaths.length} files`);
    
    for (let i = 0; i < allFilePaths.length; i += 100) {
      const batch = allFilePaths.slice(i, i + 100);
      const { error: storageError } = await supabase.storage
        .from('knowledge-pdfs')
        .remove(batch);

      if (storageError) {
        console.error(`[STORAGE] Error batch ${i}-${i + 100}:`, storageError);
        // Don't throw - continue with other batches
      } else {
        deletedFiles += batch.length;
        console.log(`[STORAGE] Deleted batch ${i}-${i + 100} (${batch.length} files)`);
      }
    }

    console.log(`[SUCCESS] Deleted ${totalDeleted} documents, ${deletedFiles} files`);

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
