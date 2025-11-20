import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupResult {
  documentsDeleted: number;
  chunksDeleted: number;
  linksDeleted: number;
  filesDeleted: number;
  deletedDocuments: {
    id: string;
    file_name: string;
    reason: string;
    file_path: string;
  }[];
  errors: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[cleanup-broken-pdfs] Starting cleanup of broken PDFs...');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const result: CleanupResult = {
      documentsDeleted: 0,
      chunksDeleted: 0,
      linksDeleted: 0,
      filesDeleted: 0,
      deletedDocuments: [],
      errors: []
    };

    // Step 1: Identify all broken PDFs
    console.log('[cleanup-broken-pdfs] Step 1: Identifying broken PDFs...');
    
    const { data: brokenDocs, error: queryError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path, processing_status, validation_status, full_text')
      .or('processing_status.neq.ready_for_assignment,validation_status.eq.validation_failed,full_text.is.null');

    if (queryError) {
      throw new Error(`Failed to query broken documents: ${queryError.message}`);
    }

    if (!brokenDocs || brokenDocs.length === 0) {
      console.log('[cleanup-broken-pdfs] No broken PDFs found!');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No broken PDFs to clean up',
          result 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[cleanup-broken-pdfs] Found ${brokenDocs.length} broken PDFs to delete`);

    // Step 2: Process each broken document
    for (const doc of brokenDocs) {
      console.log(`[cleanup-broken-pdfs] Processing: ${doc.file_name}`);
      
      const reason = doc.validation_status === 'validation_failed' 
        ? 'validation_failed'
        : !doc.full_text 
        ? 'no_full_text'
        : doc.processing_status !== 'ready_for_assignment'
        ? `status_${doc.processing_status}`
        : 'unknown';

      try {
        // Step 2a: Delete chunks from agent_knowledge
        const { error: chunksError, count: chunksCount } = await supabase
          .from('agent_knowledge')
          .delete({ count: 'exact' })
          .eq('pool_document_id', doc.id);

        if (chunksError) {
          result.errors.push(`Failed to delete chunks for ${doc.file_name}: ${chunksError.message}`);
        } else {
          result.chunksDeleted += chunksCount || 0;
          console.log(`  ✓ Deleted ${chunksCount || 0} chunks`);
        }

        // Step 2b: Delete links from agent_document_links
        const { error: linksError, count: linksCount } = await supabase
          .from('agent_document_links')
          .delete({ count: 'exact' })
          .eq('document_id', doc.id);

        if (linksError) {
          result.errors.push(`Failed to delete links for ${doc.file_name}: ${linksError.message}`);
        } else {
          result.linksDeleted += linksCount || 0;
          console.log(`  ✓ Deleted ${linksCount || 0} links`);
        }

        // Step 2c: Delete physical file from storage
        if (doc.file_path) {
          // Try to extract bucket and path
          let bucket = 'shared-pool-uploads';
          let filePath = doc.file_path;

          if (doc.file_path.includes('/')) {
            const parts = doc.file_path.split('/');
            if (parts.length >= 2 && (parts[0] === 'shared-pool-uploads' || parts[0] === 'knowledge-pdfs')) {
              bucket = parts[0];
              filePath = parts.slice(1).join('/');
            }
          }

          const { error: storageError } = await supabase.storage
            .from(bucket)
            .remove([filePath]);

          if (storageError) {
            console.warn(`  ⚠️ Could not delete file from storage: ${storageError.message}`);
          } else {
            result.filesDeleted++;
            console.log(`  ✓ Deleted file from storage: ${bucket}/${filePath}`);
          }
        }

        // Step 2d: Delete document record
        const { error: docError } = await supabase
          .from('knowledge_documents')
          .delete()
          .eq('id', doc.id);

        if (docError) {
          result.errors.push(`Failed to delete document ${doc.file_name}: ${docError.message}`);
        } else {
          result.documentsDeleted++;
          result.deletedDocuments.push({
            id: doc.id,
            file_name: doc.file_name,
            reason,
            file_path: doc.file_path
          });
          console.log(`  ✓ Deleted document record`);
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error processing ${doc.file_name}: ${errorMsg}`);
        console.error(`[cleanup-broken-pdfs] Error processing ${doc.file_name}:`, error);
      }
    }

    console.log('[cleanup-broken-pdfs] ========== CLEANUP COMPLETE ==========');
    console.log(`Documents deleted: ${result.documentsDeleted}`);
    console.log(`Chunks deleted: ${result.chunksDeleted}`);
    console.log(`Links deleted: ${result.linksDeleted}`);
    console.log(`Files deleted: ${result.filesDeleted}`);
    console.log(`Errors encountered: ${result.errors.length}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Cleanup completed: ${result.documentsDeleted} documents deleted`,
        result 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[cleanup-broken-pdfs] Fatal error:', error);
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
