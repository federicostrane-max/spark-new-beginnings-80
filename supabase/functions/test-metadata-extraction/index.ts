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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log('[test-metadata] Starting test on problematic documents...');

    // Find documents with problematic titles
    const { data: docs } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path, extracted_title, extracted_authors')
      .or('file_name.ilike.%Webb_2017%,file_name.ilike.%LLM-Engineers%,file_name.ilike.%35711%');

    if (!docs || docs.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No problematic documents found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    console.log(`[test-metadata] Found ${docs.length} documents to test`);

    const results = [];

    for (const doc of docs) {
      console.log(`\n[test-metadata] ========== Testing: ${doc.file_name} ==========`);
      console.log(`[test-metadata] Current title: "${doc.extracted_title}"`);
      console.log(`[test-metadata] Current authors: ${doc.extracted_authors || 'none'}`);
      
      try {
        const startTime = Date.now();
        
        // Extract with full multi-strategy (Vision + Text + Web Validation)
        const result = await extractMetadataWithFallback(
          supabase,
          doc.id,
          doc.file_path,
          doc.file_name,
          true // Enable web validation
        );
        
        const duration = Date.now() - startTime;

        console.log(`[test-metadata] ✅ Extraction completed in ${duration}ms`);
        console.log(`[test-metadata] New title: "${result.title}"`);
        console.log(`[test-metadata] New authors: ${result.authors?.join(', ') || 'none'}`);
        console.log(`[test-metadata] Confidence: ${result.confidence}`);
        console.log(`[test-metadata] Method: ${result.extractionMethod}`);
        console.log(`[test-metadata] Verified online: ${result.verifiedOnline ? 'YES' : 'NO'}`);
        if (result.verifiedSource) {
          console.log(`[test-metadata] Source: ${result.verifiedSource}`);
        }

        // Update document in database
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
          
          console.log(`[test-metadata] 💾 Database updated`);
        }

        results.push({
          file_name: doc.file_name,
          old_title: doc.extracted_title,
          new_title: result.title,
          old_authors: doc.extracted_authors,
          new_authors: result.authors,
          confidence: result.confidence,
          extraction_method: result.extractionMethod,
          verified_online: result.verifiedOnline,
          verified_source: result.verifiedSource,
          duration_ms: duration,
          success: result.success
        });

      } catch (error) {
        console.error(`[test-metadata] ❌ Error for ${doc.file_name}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          file_name: doc.file_name,
          error: errorMessage,
          success: false
        });
      }
    }

    console.log('\n[test-metadata] ========== TEST SUMMARY ==========');
    console.log(`[test-metadata] Total documents tested: ${results.length}`);
    console.log(`[test-metadata] Successful: ${results.filter(r => r.success).length}`);
    console.log(`[test-metadata] Failed: ${results.filter(r => !r.success).length}`);
    console.log(`[test-metadata] High confidence: ${results.filter(r => r.confidence === 'high').length}`);
    console.log(`[test-metadata] Verified online: ${results.filter(r => r.verified_online).length}`);

    return new Response(
      JSON.stringify({
        summary: {
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          high_confidence: results.filter(r => r.confidence === 'high').length,
          verified_online: results.filter(r => r.verified_online).length
        },
        results
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[test-metadata] ❌ Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
