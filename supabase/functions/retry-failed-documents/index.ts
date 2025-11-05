import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * This function reprocesses documents that were downloaded but never processed
 * (stuck in 'downloaded' status without chunks in agent_knowledge)
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[retry-failed-documents] ========== START ==========');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get batch limit from request body (default 5)
    const { limit = 5 } = await req.json().catch(() => ({ limit: 5 }));
    console.log(`[retry-failed-documents] Processing max ${limit} documents per batch`);

    // Count total stuck documents
    const { count: totalStuck } = await supabase
      .from('knowledge_documents')
      .select('*', { count: 'exact', head: true })
      .eq('validation_status', 'validated')
      .eq('processing_status', 'downloaded');

    console.log(`[retry-failed-documents] Total stuck documents: ${totalStuck || 0}`);

    // Find documents that are validated but not processed (limited by batch size)
    const { data: stuckDocuments, error: queryError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, validation_status, processing_status')
      .eq('validation_status', 'validated')
      .eq('processing_status', 'downloaded')
      .limit(limit);

    if (queryError) {
      throw new Error(`Query failed: ${queryError.message}`);
    }

    console.log(`[retry-failed-documents] Found ${stuckDocuments?.length || 0} stuck documents`);

    if (!stuckDocuments || stuckDocuments.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'No stuck documents found',
          processed: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];
    const DELAY_MS = 3000; // 3 seconds delay between documents to avoid rate limits

    for (const doc of stuckDocuments) {
      console.log(`\n[retry-failed-documents] Processing: ${doc.file_name} (${doc.id})`);
      
      try {
        // Step 1: Extract text from PDF
        console.log(`  [1/2] Extracting text...`);
        const { data: extractionResult, error: extractionError } = await supabase.functions.invoke('extract-pdf-text', {
          body: { documentId: doc.id }
        });

        if (extractionError || !extractionResult?.text) {
          throw new Error(`Text extraction failed: ${extractionError?.message || 'No text returned'}`);
        }

        const extractedText = extractionResult.text;
        console.log(`  ✓ Extracted ${extractedText.length} characters`);

        // Step 2: Trigger processing with extracted text
        console.log(`  [2/2] Triggering processing...`);
        const { error: processError } = await supabase.functions.invoke('process-document', {
          body: { 
            documentId: doc.id,
            fullText: extractedText
          }
        });

        if (processError) {
          throw new Error(`Processing failed: ${processError.message}`);
        }

        console.log(`  ✓ Processing triggered successfully`);

        results.push({
          id: doc.id,
          file_name: doc.file_name,
          status: 'success',
          text_length: extractedText.length
        });

      } catch (docError) {
        console.error(`  ✗ Error processing ${doc.file_name}:`, docError);
        results.push({
          id: doc.id,
          file_name: doc.file_name,
          status: 'error',
          error: docError instanceof Error ? docError.message : 'Unknown error'
        });
      }
      
      // Add delay between documents to avoid hitting Google Vision API rate limits
      if (stuckDocuments.indexOf(doc) < stuckDocuments.length - 1) {
        console.log(`  ⏸️  Waiting ${DELAY_MS/1000}s before next document...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    // Count remaining stuck documents after processing
    const { count: remainingStuck } = await supabase
      .from('knowledge_documents')
      .select('*', { count: 'exact', head: true })
      .eq('validation_status', 'validated')
      .eq('processing_status', 'downloaded');

    console.log(`\n[retry-failed-documents] ========== SUMMARY ==========`);
    console.log(`  Batch size: ${results.length}`);
    console.log(`  Successful: ${successCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Remaining stuck: ${remainingStuck || 0}`);
    console.log('[retry-failed-documents] ========== END ==========');

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Processed ${results.length} documents: ${successCount} successful, ${errorCount} errors`,
        processed: results.length,
        successful: successCount,
        errors: errorCount,
        totalStuck: totalStuck || 0,
        remainingStuck: remainingStuck || 0,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[retry-failed-documents] ❌ FATAL ERROR:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
