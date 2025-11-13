import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import { extractMetadataWithFallback } from '../_shared/metadataExtractor.ts';

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

    const results = {
      metadataExtracted: 0,
      documentsProcessed: 0,
      failedDeleted: 0,
      downloadedDeleted: 0,
      errors: [] as string[]
    };

    // STEP 1: Estrai metadata da documenti ready_for_assignment senza metadata
    console.log('[cleanup] Step 1: Extracting metadata from ready documents...');
    const { data: readyDocs } = await supabase
      .from('knowledge_documents')
      .select('id, file_path, file_name')
      .eq('processing_status', 'ready_for_assignment')
      .eq('validation_status', 'validated')
      .is('extracted_title', null);

    for (const doc of readyDocs || []) {
      try {
        const result = await extractMetadataWithFallback(supabase, doc.id, doc.file_path);
        
        if (result.success) {
          await supabase
            .from('knowledge_documents')
            .update({
              extracted_title: result.title,
              extracted_authors: result.authors
            })
            .eq('id', doc.id);
          
          results.metadataExtracted++;
          console.log(`[cleanup] ✅ Metadata: ${doc.file_name}`);
        }
      } catch (error) {
        results.errors.push(`Metadata ${doc.file_name}: ${error}`);
      }
    }

    // STEP 2: Processa documenti in stato "downloaded"
    console.log('[cleanup] Step 2: Processing downloaded documents...');
    const { data: downloadedDocs } = await supabase
      .from('knowledge_documents')
      .select('id, file_path, file_name')
      .eq('processing_status', 'downloaded');

    for (const doc of downloadedDocs || []) {
      try {
        // Triggera il processing
        await supabase.functions.invoke('process-document', {
          body: { documentId: doc.id, filePath: doc.file_path }
        });
        results.documentsProcessed++;
        console.log(`[cleanup] 🔄 Processing: ${doc.file_name}`);
      } catch (error) {
        results.errors.push(`Process ${doc.file_name}: ${error}`);
      }
    }

    // STEP 3: Elimina documenti validation_failed senza chunks
    console.log('[cleanup] Step 3: Cleaning validation_failed documents...');
    const { data: failedDocs } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .eq('processing_status', 'validation_failed');

    for (const doc of failedDocs || []) {
      const { data: chunks } = await supabase
        .from('agent_knowledge')
        .select('id')
        .eq('pool_document_id', doc.id)
        .limit(1);

      if (!chunks || chunks.length === 0) {
        await supabase
          .from('agent_document_links')
          .delete()
          .eq('document_id', doc.id);
        
        await supabase
          .from('knowledge_documents')
          .delete()
          .eq('id', doc.id);
        
        results.failedDeleted++;
        console.log(`[cleanup] 🗑️ Deleted failed: ${doc.file_name}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
      totalActions: results.metadataExtracted + results.documentsProcessed + 
                    results.failedDeleted + results.downloadedDeleted
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[cleanup] Fatal error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
