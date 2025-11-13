import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch ALL documents regardless of metadata status
    const { data: documents, error: fetchError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path, extracted_title, extracted_authors')
      .eq('validation_status', 'validated')
      .order('created_at', { ascending: true });

    if (fetchError) throw fetchError;

    console.log(`[reprocess-all] Found ${documents?.length || 0} documents to reprocess`);

    let successCount = 0;
    let errorCount = 0;
    const results: any[] = [];

    for (const doc of documents || []) {
      try {
        console.log(`[reprocess-all] Processing ${doc.file_name}...`);
        console.log(`[reprocess-all] Old metadata: title="${doc.extracted_title}", authors=${JSON.stringify(doc.extracted_authors)}`);

        const metadata = await extractMetadataWithFallback(
          supabase,
          doc.id,
          doc.file_path,
          doc.file_name,
          true // enable web validation
        );

        console.log(`[reprocess-all] New metadata: title="${metadata.title}", authors=${JSON.stringify(metadata.authors)}, confidence=${metadata.confidence}, method=${metadata.extractionMethod}`);

        // Update with new metadata
        const { error: updateError } = await supabase
          .from('knowledge_documents')
          .update({
            extracted_title: metadata.title,
            extracted_authors: metadata.authors,
          })
          .eq('id', doc.id);

        if (updateError) throw updateError;

        successCount++;
        results.push({
          id: doc.id,
          fileName: doc.file_name,
          oldTitle: doc.extracted_title,
          newTitle: metadata.title,
          confidence: metadata.confidence,
          method: metadata.extractionMethod,
          changed: doc.extracted_title !== metadata.title
        });

      } catch (error) {
        console.error(`[reprocess-all] Error processing ${doc.file_name}:`, error);
        errorCount++;
        results.push({
          id: doc.id,
          fileName: doc.file_name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`[reprocess-all] Complete: ${successCount} success, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: documents?.length || 0,
        successCount,
        errorCount,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[reprocess-all] Fatal error:', error);
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