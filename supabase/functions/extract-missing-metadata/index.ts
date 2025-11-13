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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[extract-missing-metadata] Starting retro-processing...');

    // Fetch all documents without extracted_title
    const { data: documents, error: fetchError } = await supabase
      .from('knowledge_documents')
      .select('id, file_path, file_name')
      .is('extracted_title', null)
      .eq('processing_status', 'ready_for_assignment')
      .eq('validation_status', 'validated');

    if (fetchError) throw fetchError;

    console.log(`[extract-missing-metadata] Found ${documents?.length || 0} documents to process`);

    let successCount = 0;
    let errorCount = 0;

    for (const doc of documents || []) {
      try {
        console.log(`[extract-missing-metadata] Processing: ${doc.file_name}`);

        // Use shared metadata extractor with automatic fallback
        const result = await extractMetadataWithFallback(supabase, doc.id, doc.file_path);

        if (result.success) {
          // Update document with extracted metadata
          const { error: updateError } = await supabase
            .from('knowledge_documents')
            .update({
              extracted_title: result.title,
              extracted_authors: result.authors
            })
            .eq('id', doc.id);

          if (updateError) throw updateError;

          console.log(`[extract-missing-metadata] ✅ ${doc.file_name}: "${result.title}" (source: ${result.source})`);
          successCount++;
        } else {
          console.error(`[extract-missing-metadata] ❌ ${doc.file_name}: Failed to extract metadata`);
          errorCount++;
        }

      } catch (docError) {
        console.error(`[extract-missing-metadata] Error processing ${doc.file_name}:`, docError);
        errorCount++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: documents?.length || 0,
      successCount,
      errorCount
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[extract-missing-metadata] Fatal error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
