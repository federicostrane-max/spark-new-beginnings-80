import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RepairResult {
  documentsWithChunks: {
    fixed: number;
    errors: Array<{ id: string; fileName: string; error: string }>;
  };
  documentsWithoutChunks: {
    reprocessed: number;
    deleted: number;
    linksRemoved: number;
    errors: Array<{ id: string; fileName: string; error: string }>;
  };
  totalProcessed: number;
}

async function tryDownloadPDF(supabase: any, filePath: string, fileName: string): Promise<boolean> {
  const pathVariants = [
    filePath,
    `shared-pool-uploads/${filePath}`,
    `shared-pool-uploads/${fileName}`,
    fileName,
  ];

  for (const variant of pathVariants) {
    try {
      const { data, error } = await supabase.storage
        .from('knowledge-pdfs')
        .download(variant);

      if (!error && data) {
        console.log(`[PDF Found] ${fileName} at path: ${variant}`);
        return true;
      }
    } catch (e) {
      // Try next variant
      continue;
    }
  }

  console.log(`[PDF Not Found] ${fileName} - tried all path variants`);
  return false;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[repair-pending-documents] Starting repair process...');

    const result: RepairResult = {
      documentsWithChunks: { fixed: 0, errors: [] },
      documentsWithoutChunks: { reprocessed: 0, deleted: 0, linksRemoved: 0, errors: [] },
      totalProcessed: 0,
    };

    // PHASE 1: Find and fix documents that have chunks but wrong status
    console.log('[PHASE 1] Processing documents with existing chunks...');
    
    const { data: chunksGrouped, error: chunksError } = await supabase
      .from('agent_knowledge')
      .select('pool_document_id')
      .not('pool_document_id', 'is', null);

    if (chunksError) throw chunksError;

    const docIdsWithChunks = [...new Set(chunksGrouped?.map((c: any) => c.pool_document_id) || [])];
    console.log(`[PHASE 1] Found ${docIdsWithChunks.length} unique documents with chunks`);

    const { data: docsWithChunks, error: docsWithChunksError } = await supabase
      .from('knowledge_documents')
      .select('*')
      .eq('processing_status', 'pending_processing')
      .in('id', docIdsWithChunks);

    if (docsWithChunksError) throw docsWithChunksError;

    console.log(`[PHASE 1] Processing ${docsWithChunks?.length || 0} documents with chunks in pending_processing`);

    for (const doc of docsWithChunks || []) {
      try {
        console.log(`[PHASE 1] Processing: ${doc.file_name}`);

        // Check if metadata is missing
        if (!doc.extracted_title || !doc.extracted_authors) {
          console.log(`[PHASE 1] ${doc.file_name}: Missing metadata, invoking extract-missing-metadata`);
          
          const { error: metadataError } = await supabase.functions.invoke('extract-missing-metadata', {
            body: { documentId: doc.id }
          });

          if (metadataError) {
            console.error(`[PHASE 1] ${doc.file_name}: Failed to extract metadata:`, metadataError);
            result.documentsWithChunks.errors.push({
              id: doc.id,
              fileName: doc.file_name,
              error: `Metadata extraction failed: ${metadataError.message}`
            });
            continue;
          }
        }

        // Update status to ready_for_assignment
        const { error: updateError } = await supabase
          .from('knowledge_documents')
          .update({
            processing_status: 'ready_for_assignment',
            validation_status: 'validated',
            processed_at: new Date().toISOString()
          })
          .eq('id', doc.id);

        if (updateError) throw updateError;

        console.log(`[PHASE 1] ✅ ${doc.file_name}: Status updated to ready_for_assignment`);
        result.documentsWithChunks.fixed++;
        result.totalProcessed++;

        await sleep(500); // Rate limiting

      } catch (error) {
        console.error(`[PHASE 1] Error processing ${doc.file_name}:`, error);
        result.documentsWithChunks.errors.push({
          id: doc.id,
          fileName: doc.file_name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // PHASE 2: Find and handle documents without chunks
    console.log('[PHASE 2] Processing documents without chunks...');

    const { data: docsWithoutChunks, error: docsWithoutChunksError } = await supabase
      .from('knowledge_documents')
      .select('*')
      .eq('processing_status', 'pending_processing')
      .not('id', 'in', docIdsWithChunks.length > 0 ? `(${docIdsWithChunks.map(id => `'${id}'`).join(',')})` : '()');

    if (docsWithoutChunksError) throw docsWithoutChunksError;

    console.log(`[PHASE 2] Processing ${docsWithoutChunks?.length || 0} documents without chunks`);

    for (const doc of docsWithoutChunks || []) {
      try {
        console.log(`[PHASE 2] Processing: ${doc.file_name}`);

        // Try to find the PDF in storage
        const pdfExists = await tryDownloadPDF(supabase, doc.file_path, doc.file_name);

        if (pdfExists) {
          // PDF found - reprocess the document
          console.log(`[PHASE 2] ${doc.file_name}: PDF found, invoking process-document`);
          
          const { error: processError } = await supabase.functions.invoke('process-document', {
            body: { documentId: doc.id }
          });

          if (processError) {
            console.error(`[PHASE 2] ${doc.file_name}: Failed to reprocess:`, processError);
            result.documentsWithoutChunks.errors.push({
              id: doc.id,
              fileName: doc.file_name,
              error: `Reprocessing failed: ${processError.message}`
            });
          } else {
            console.log(`[PHASE 2] ✅ ${doc.file_name}: Reprocessing initiated`);
            result.documentsWithoutChunks.reprocessed++;
            result.totalProcessed++;
          }

        } else {
          // PDF not found - DELETE COMPLETELY
          console.log(`[PHASE 2] ${doc.file_name}: PDF not found in storage - DELETING COMPLETELY`);

          // 1. Remove any agent_document_links
          const { data: links, error: linksQueryError } = await supabase
            .from('agent_document_links')
            .select('id')
            .eq('document_id', doc.id);

          if (linksQueryError) {
            console.error(`[PHASE 2] ${doc.file_name}: Error querying links:`, linksQueryError);
          } else if (links && links.length > 0) {
            const { error: deleteLinkError } = await supabase
              .from('agent_document_links')
              .delete()
              .eq('document_id', doc.id);

            if (deleteLinkError) {
              console.error(`[PHASE 2] ${doc.file_name}: Error deleting links:`, deleteLinkError);
            } else {
              console.log(`[PHASE 2] ${doc.file_name}: Removed ${links.length} agent_document_links`);
              result.documentsWithoutChunks.linksRemoved += links.length;
            }
          }

          // 2. Delete the document record
          const { error: deleteDocError } = await supabase
            .from('knowledge_documents')
            .delete()
            .eq('id', doc.id);

          if (deleteDocError) {
            console.error(`[PHASE 2] ${doc.file_name}: Error deleting document:`, deleteDocError);
            result.documentsWithoutChunks.errors.push({
              id: doc.id,
              fileName: doc.file_name,
              error: `Deletion failed: ${deleteDocError.message}`
            });
          } else {
            console.log(`[PHASE 2] ✅ ${doc.file_name}: COMPLETELY DELETED (PDF not found)`);
            result.documentsWithoutChunks.deleted++;
            result.totalProcessed++;
          }
        }

        await sleep(500); // Rate limiting

      } catch (error) {
        console.error(`[PHASE 2] Error processing ${doc.file_name}:`, error);
        result.documentsWithoutChunks.errors.push({
          id: doc.id,
          fileName: doc.file_name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log('[repair-pending-documents] Repair completed');
    console.log(`[SUMMARY] Total processed: ${result.totalProcessed}`);
    console.log(`[SUMMARY] Documents with chunks fixed: ${result.documentsWithChunks.fixed}`);
    console.log(`[SUMMARY] Documents reprocessed: ${result.documentsWithoutChunks.reprocessed}`);
    console.log(`[SUMMARY] Documents deleted: ${result.documentsWithoutChunks.deleted}`);
    console.log(`[SUMMARY] Links removed: ${result.documentsWithoutChunks.linksRemoved}`);
    console.log(`[SUMMARY] Total errors: ${result.documentsWithChunks.errors.length + result.documentsWithoutChunks.errors.length}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[repair-pending-documents] Fatal error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
