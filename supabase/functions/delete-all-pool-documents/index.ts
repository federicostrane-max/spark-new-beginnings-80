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

    // Separate document IDs by pipeline
    const { data: legacyDocs } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .in('id', documentIds);

    const { data: pipelineBDocs } = await supabase
      .from('pipeline_b_documents')
      .select('id, file_name')
      .in('id', documentIds);

    const legacyIds = legacyDocs?.map(d => d.id) || [];
    const pipelineBIds = pipelineBDocs?.map(d => d.id) || [];

    console.log(`[DELETE] Legacy docs: ${legacyIds.length}, Pipeline B docs: ${pipelineBIds.length}`);

    // Use smaller batches (50) to avoid database timeouts on heavy operations
    const BATCH_SIZE = 50;
    let totalDeleted = 0;
    const allFilePaths: Array<{ bucket: string; path: string }> = [];

    // Process Legacy documents
    for (let i = 0; i < legacyIds.length; i += BATCH_SIZE) {
      const batchIds = legacyIds.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[LEGACY BATCH ${batchNum}] Processing ${batchIds.length} documents`);

      // 1. Get file paths BEFORE deleting documents
      const { data: documents, error: fetchError } = await supabase
        .from('knowledge_documents')
        .select('id, file_name')
        .in('id', batchIds);

      if (fetchError) {
        console.error(`[LEGACY BATCH ${batchNum}] Error fetching documents:`, fetchError);
        throw fetchError;
      }

      if (documents && documents.length > 0) {
        documents.forEach(doc => {
          if (doc.id && doc.file_name) {
            allFilePaths.push({ bucket: 'knowledge-pdfs', path: `${doc.id}/${doc.file_name}` });
          }
        });
      }

      // 2. Delete agent_document_links
      const { error: linksError } = await supabase
        .from('agent_document_links')
        .delete()
        .in('document_id', batchIds);

      if (linksError) console.error(`[LEGACY BATCH ${batchNum}] Error deleting links:`, linksError);

      // 3. Delete agent_knowledge (shared pool chunks)
      const { error: chunksError } = await supabase
        .from('agent_knowledge')
        .delete()
        .in('pool_document_id', batchIds);

      if (chunksError) console.error(`[LEGACY BATCH ${batchNum}] Error deleting chunks:`, chunksError);

      // 4. Delete document_processing_cache
      const { error: cacheError } = await supabase
        .from('document_processing_cache')
        .delete()
        .in('document_id', batchIds);

      if (cacheError) console.error(`[LEGACY BATCH ${batchNum}] Error deleting cache:`, cacheError);

      // 5. Delete from knowledge_documents table
      const { error: deleteError } = await supabase
        .from('knowledge_documents')
        .delete()
        .in('id', batchIds);

      if (deleteError) throw deleteError;
      
      totalDeleted += batchIds.length;
      console.log(`[LEGACY BATCH ${batchNum}] Deleted ${batchIds.length} documents`);
    }

    // Process Pipeline B documents
    for (let i = 0; i < pipelineBIds.length; i += BATCH_SIZE) {
      const batchIds = pipelineBIds.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[PIPELINE B BATCH ${batchNum}] Processing ${batchIds.length} documents`);

      // 1. Get file paths BEFORE deleting documents
      const { data: documents, error: fetchError } = await supabase
        .from('pipeline_b_documents')
        .select('id, file_path, storage_bucket')
        .in('id', batchIds);

      if (fetchError) {
        console.error(`[PIPELINE B BATCH ${batchNum}] Error fetching documents:`, fetchError);
        throw fetchError;
      }

      if (documents && documents.length > 0) {
        documents.forEach(doc => {
          if (doc.file_path && doc.storage_bucket) {
            allFilePaths.push({ bucket: doc.storage_bucket, path: doc.file_path });
          }
        });
      }

      // 2. Delete agent_document_links
      const { error: linksError } = await supabase
        .from('agent_document_links')
        .delete()
        .in('document_id', batchIds);

      if (linksError) console.error(`[PIPELINE B BATCH ${batchNum}] Error deleting links:`, linksError);

      // 3. Get chunk IDs first, then delete pipeline_b_agent_knowledge
      const { data: chunks } = await supabase
        .from('pipeline_b_chunks_raw')
        .select('id')
        .in('document_id', batchIds);

      if (chunks && chunks.length > 0) {
        const chunkIds = chunks.map(c => c.id);
        const { error: agentKnowledgeError } = await supabase
          .from('pipeline_b_agent_knowledge')
          .delete()
          .in('chunk_id', chunkIds);

        if (agentKnowledgeError) console.error(`[PIPELINE B BATCH ${batchNum}] Error deleting agent knowledge:`, agentKnowledgeError);
      }

      // 4. Delete pipeline_b_chunks_raw
      const { error: chunksError } = await supabase
        .from('pipeline_b_chunks_raw')
        .delete()
        .in('document_id', batchIds);

      if (chunksError) throw chunksError;

      // 5. Delete from pipeline_b_documents table
      const { error: deleteError } = await supabase
        .from('pipeline_b_documents')
        .delete()
        .in('id', batchIds);

      if (deleteError) throw deleteError;
      
      totalDeleted += batchIds.length;
      console.log(`[PIPELINE B BATCH ${batchNum}] Deleted ${batchIds.length} documents`);
    }

    // Delete storage files from both buckets in batches of 100 (Supabase storage limit)
    let deletedFiles = 0;
    console.log(`[STORAGE] Deleting ${allFilePaths.length} files`);
    
    // Group by bucket
    const bucketGroups = new Map<string, string[]>();
    allFilePaths.forEach(({ bucket, path }) => {
      if (!bucketGroups.has(bucket)) {
        bucketGroups.set(bucket, []);
      }
      bucketGroups.get(bucket)!.push(path);
    });

    for (const [bucket, paths] of bucketGroups.entries()) {
      console.log(`[STORAGE] Processing ${paths.length} files from bucket: ${bucket}`);
      
      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100);
        const { error: storageError } = await supabase.storage
          .from(bucket)
          .remove(batch);

        if (storageError) {
          console.error(`[STORAGE] Error deleting from ${bucket}, batch ${i}-${i + 100}:`, storageError);
        } else {
          deletedFiles += batch.length;
          console.log(`[STORAGE] Deleted batch from ${bucket} ${i}-${i + 100} (${batch.length} files)`);
        }
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