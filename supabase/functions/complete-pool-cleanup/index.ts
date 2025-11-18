import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';
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
    const { forceReExtraction = false } = await req.json().catch(() => ({}));
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const results = {
      metadataExtracted: 0,
      metadataConfirmed: 0,
      metadataImproved: 0,
      metadataChanged: 0,
      documentsProcessed: 0,
      failedDeleted: 0,
      downloadedDeleted: 0,
      totalAttempts: 0,
      verifiedOnline: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      errors: [] as string[],
      details: [] as any[]
    };

    // LOOP PERSISTENTE: Continua finché ci sono documenti senza metadata
    const MAX_ITERATIONS = 5;
    let iteration = 0;
    
    while (iteration < MAX_ITERATIONS) {
      iteration++;
      console.log(`[cleanup] === Iteration ${iteration}/${MAX_ITERATIONS} ===`);
      
      // STEP 1: Estrai metadata da documenti ready_for_assignment
      const stepLabel = forceReExtraction 
        ? 'Step 1: Re-extracting metadata from ALL ready documents...'
        : 'Step 1: Extracting metadata from ready documents without title...';
      console.log(`[cleanup] ${stepLabel}`);
      
      let query = supabase
        .from('knowledge_documents')
        .select('id, file_path, file_name, extracted_title, extracted_authors, metadata_confidence, metadata_extraction_method, metadata_verified_online')
        .eq('processing_status', 'ready_for_assignment')
        .eq('validation_status', 'validated');
      
      // Solo se NON forceReExtraction, filtra per documenti senza titolo
      if (!forceReExtraction) {
        query = query.is('extracted_title', null);
      }
      
      const { data: readyDocs } = await query;

      if (!readyDocs || readyDocs.length === 0) {
        console.log('[cleanup] ✅ No more documents without metadata');
        break;
      }

      console.log(`[cleanup] Found ${readyDocs.length} documents without metadata`);

      for (const doc of readyDocs) {
        try {
          results.totalAttempts++;
          
          // Store old metadata for comparison
          const oldMetadata = {
            title: doc.extracted_title,
            authors: doc.extracted_authors,
            confidence: doc.metadata_confidence,
            method: doc.metadata_extraction_method,
            verified: doc.metadata_verified_online
          };
          
          console.log(`[cleanup] 📄 Processing: ${doc.file_name}`);
          if (forceReExtraction && oldMetadata.title) {
            console.log(`[cleanup]   OLD: title="${oldMetadata.title}" | authors=${JSON.stringify(oldMetadata.authors)} | confidence=${oldMetadata.confidence} | method=${oldMetadata.method} | verified=${oldMetadata.verified}`);
          }
          
          const result = await extractMetadataWithFallback(
            supabase, 
            doc.id, 
            doc.file_path, 
            doc.file_name,
            true // Enable web validation
          );
          
          if (result.success) {
            // Compare old vs new metadata
            let changeType = 'extracted'; // new extraction
            
            if (forceReExtraction && oldMetadata.title) {
              if (oldMetadata.title !== result.title) {
                console.log(`[cleanup]   🔄 TITLE CHANGE: "${oldMetadata.title}" → "${result.title}"`);
                changeType = 'changed';
                results.metadataChanged++;
              } else if (JSON.stringify(oldMetadata.authors) !== JSON.stringify(result.authors)) {
                console.log(`[cleanup]   🔄 AUTHORS CHANGE: ${JSON.stringify(oldMetadata.authors)} → ${JSON.stringify(result.authors)}`);
                changeType = 'changed';
                results.metadataChanged++;
              } else if (oldMetadata.confidence !== result.confidence || !oldMetadata.verified && result.verifiedOnline) {
                console.log(`[cleanup]   ⬆️ IMPROVED: confidence ${oldMetadata.confidence}→${result.confidence}, verified ${oldMetadata.verified}→${result.verifiedOnline}`);
                changeType = 'improved';
                results.metadataImproved++;
              } else {
                console.log(`[cleanup]   ✓ CONFIRMED: metadata matches`);
                changeType = 'confirmed';
                results.metadataConfirmed++;
              }
            } else {
              results.metadataExtracted++;
            }
            
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
            
            // Track confidence distribution
            if (result.confidence === 'high') results.highConfidence++;
            else if (result.confidence === 'medium') results.mediumConfidence++;
            else if (result.confidence === 'low') results.lowConfidence++;
            
            if (result.verifiedOnline) results.verifiedOnline++;
            
            console.log(`[cleanup]   NEW: title="${result.title}" | authors=${JSON.stringify(result.authors)} | confidence=${result.confidence} | method=${result.extractionMethod} | verified=${result.verifiedOnline}`);
            console.log(`[cleanup]   ACTION: ${changeType.toUpperCase()}`);
            
            results.details.push({
              fileName: doc.file_name,
              changeType,
              oldTitle: oldMetadata.title,
              newTitle: result.title,
              confidence: result.confidence,
              method: result.extractionMethod,
              verified: result.verifiedOnline
            });
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

    console.log('[cleanup] === FINAL SUMMARY ===');
    console.log(`[cleanup] Total processed: ${results.totalAttempts}`);
    console.log(`[cleanup] Metadata extracted (new): ${results.metadataExtracted}`);
    console.log(`[cleanup] Metadata confirmed: ${results.metadataConfirmed}`);
    console.log(`[cleanup] Metadata improved: ${results.metadataImproved}`);
    console.log(`[cleanup] Metadata changed: ${results.metadataChanged}`);
    console.log(`[cleanup] Verified online: ${results.verifiedOnline}`);
    console.log(`[cleanup] Confidence - High: ${results.highConfidence}, Medium: ${results.mediumConfidence}, Low: ${results.lowConfidence}`);
    console.log(`[cleanup] Documents processed: ${results.documentsProcessed}`);
    console.log(`[cleanup] Failed deleted: ${results.failedDeleted}`);
    console.log(`[cleanup] Errors: ${results.errors.length}`);

    return new Response(JSON.stringify({
      success: true,
      ...results,
      totalActions: results.metadataExtracted + results.metadataConfirmed + 
                    results.metadataImproved + results.metadataChanged +
                    results.documentsProcessed + results.failedDeleted + results.downloadedDeleted
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
