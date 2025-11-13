import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

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

        // Extract text from PDF
        const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-pdf-text', {
          body: { documentId: doc.id, filePath: doc.file_path }
        });

        if (extractError || !extractData?.text) {
          console.error(`[extract-missing-metadata] Text extraction failed for ${doc.file_name}:`, extractError);
          errorCount++;
          continue;
        }

        const fullText = extractData.text;

        // Extract metadata using Gemini
        const metadataPrompt = `Extract the EXACT title and author(s) from this PDF text.
The title is usually found on the first page or title page.
Return ONLY a JSON object with this structure:
{
  "title": "Exact title as written in the document",
  "authors": ["Author 1", "Author 2"]
}

PDF Text (first 3000 characters):
${fullText.slice(0, 3000)}`;

        const metadataResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: metadataPrompt }],
            response_format: { type: 'json_object' }
          })
        });

        if (!metadataResponse.ok) {
          console.error(`[extract-missing-metadata] AI failed for ${doc.file_name}`);
          errorCount++;
          continue;
        }

        const metadataData = await metadataResponse.json();
        const metadata = JSON.parse(metadataData.choices[0].message.content);

        // Update document with extracted metadata
        const { error: updateError } = await supabase
          .from('knowledge_documents')
          .update({
            extracted_title: metadata.title || null,
            extracted_authors: metadata.authors || null
          })
          .eq('id', doc.id);

        if (updateError) throw updateError;

        console.log(`[extract-missing-metadata] ✅ ${doc.file_name}: "${metadata.title}"`);
        successCount++;

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
