import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔄 Starting embedding regeneration for ALL chunks...');

    // Get all chunks that need regeneration (in batches)
    const batchSize = 100;
    let offset = 0;
    let totalProcessed = 0;
    let totalErrors = 0;

    while (true) {
      const { data: chunks, error: fetchError } = await supabase
        .from('agent_knowledge')
        .select('id, content')
        .range(offset, offset + batchSize - 1);

      if (fetchError) {
        console.error('❌ Error fetching chunks:', fetchError);
        throw fetchError;
      }

      if (!chunks || chunks.length === 0) {
        break;
      }

      console.log(`📦 Processing batch: ${offset}-${offset + chunks.length}`);

      // Process chunks in smaller batches to avoid rate limits
      const embeddingBatchSize = 10;
      for (let i = 0; i < chunks.length; i += embeddingBatchSize) {
        const batch = chunks.slice(i, i + embeddingBatchSize);
        
        const embeddingPromises = batch.map(async (chunk) => {
          try {
            const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openAIApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: chunk.content,
              }),
            });

            if (!embeddingResponse.ok) {
              throw new Error(`OpenAI API error: ${embeddingResponse.statusText}`);
            }

            const embeddingData = await embeddingResponse.json();
            const embedding = embeddingData.data[0].embedding;

            // Update chunk with new embedding
            const { error: updateError } = await supabase
              .from('agent_knowledge')
              .update({ embedding })
              .eq('id', chunk.id);

            if (updateError) {
              throw new Error(`DB update error: ${updateError.message}`);
            }

            return { success: true, id: chunk.id };
          } catch (error) {
            console.error(`❌ Error processing chunk ${chunk.id}:`, error);
            return { success: false, id: chunk.id, error: error.message };
          }
        });

        const results = await Promise.all(embeddingPromises);
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;

        totalProcessed += successCount;
        totalErrors += errorCount;

        console.log(`✅ Batch ${i}-${i + batch.length}: ${successCount} success, ${errorCount} errors`);

        // Rate limit delay (1 second between batches)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      offset += chunks.length;
    }

    console.log(`🎉 Regeneration complete! Processed: ${totalProcessed}, Errors: ${totalErrors}`);

    return new Response(
      JSON.stringify({
        success: true,
        totalProcessed,
        totalErrors,
        message: `Regenerated ${totalProcessed} embeddings with ${totalErrors} errors`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('❌ Fatal error in regenerate-all-embeddings:', error);
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
