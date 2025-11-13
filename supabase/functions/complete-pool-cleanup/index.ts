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
      totalAttempts: 0,
      errors: [] as string[]
    };

    // LOOP PERSISTENTE: Continua finché ci sono documenti senza metadata
    const MAX_ITERATIONS = 5;
    let iteration = 0;
    
    while (iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(`[cleanup] === Iteration ${iteration}/${MAX_ITERATIONS} ===`);
      
      // STEP 1: Estrai metadata da documenti ready_for_assignment senza metadata
      console.log('[cleanup] Step 1: Extracting metadata from ready documents...');
      const { data: readyDocs } = await supabase
        .from('knowledge_documents')
        .select('id, file_path, file_name')
        .eq('processing_status', 'ready_for_assignment')
        .eq('validation_status', 'validated')
        .is('extracted_title', null);

      if (!readyDocs || readyDocs.length === 0) {
        console.log('[cleanup] ✅ No more documents without metadata');
        break;
      }

      console.log(`[cleanup] Found ${readyDocs.length} documents without metadata`);

      for (const doc of readyDocs) {
        try {
          results.totalAttempts++;
          console.log(`[cleanup] Attempting: ${doc.file_name}`);
          
          const result = await extractMetadataWithFallback(
            supabase, 
            doc.id, 
            doc.file_path, 
            doc.file_name,
            true // Enable web validation
          );
          
          if (result.success) {
            await supabase
              .from('knowledge_documents')
              .update({
                extracted_title: result.title,
                extracted_authors: result.authors,
                metadata_confidence: result.confidence,
                metadata_extraction_method: result.extractionMethod,
                metadata_verified_online: result.verifiedOnline || false,
                metadata_verified_source: result.verifiedSource,
                metadata_extracted_at: new Date().toISOString()
              })
              .eq('id', doc.id);
            
            results.metadataExtracted++;
            console.log(`[cleanup] ✅ Metadata: ${doc.file_name} -> "${result.title}" (${result.confidence}, ${result.extractionMethod}${result.verifiedOnline ? ', verified' : ''})`);
          } else {
            console.log(`[cleanup] ⚠️ Failed: ${doc.file_name}`);
            results.errors.push(`Metadata extraction failed: ${doc.file_name}`);
          }
        } catch (error) {
          console.error(`[cleanup] ❌ Error ${doc.file_name}:`, error);
          results.errors.push(`Metadata ${doc.file_name}: ${error}`);
        }
      }
      
      // Breve pausa tra iterazioni per evitare rate limiting
      if (iteration < MAX_ITERATIONS && readyDocs.length > 0) {
        console.log('[cleanup] Waiting 2s before next iteration...');
        await new Promise(resolve => setTimeout(resolve, 2000));
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
