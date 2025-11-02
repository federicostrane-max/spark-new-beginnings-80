import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('=== PROCESS-CHUNKS EDGE FUNCTION INVOKED ===');

  try {
    const { chunks, agentId, fileName, category, summary } = await req.json();

    console.log('Request body:', {
      chunksCount: chunks?.length,
      agentId,
      fileName,
      category,
      summary
    });

    // Validate input
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      throw new Error('Chunks array is required and must not be empty');
    }

    if (!agentId || !fileName || !category) {
      throw new Error('agentId, fileName, and category are required');
    }

    console.log(`Processing ${chunks.length} chunks for agent ${agentId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let successCount = 0;
    let errorCount = 0;

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      console.log(`Processing chunk ${i + 1}/${chunks.length} (length: ${chunk.length})`);

      try {
        // Generate embedding for this chunk
        console.log(`Generating embedding for chunk ${i + 1}...`);
        const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke(
          'generate-embedding',
          { body: { text: chunk } }
        );

        if (embeddingError) {
          console.error(`Embedding error for chunk ${i + 1}:`, embeddingError);
          errorCount++;
          continue;
        }

        if (!embeddingData?.embedding) {
          console.error(`No embedding returned for chunk ${i + 1}`);
          errorCount++;
          continue;
        }

        console.log(`Embedding generated successfully for chunk ${i + 1}`);

        // Insert chunk into database
        console.log(`Inserting chunk ${i + 1} into database...`);
        const { error: insertError } = await supabase
          .from('agent_knowledge')
          .insert({
            agent_id: agentId,
            document_name: `${fileName} (chunk ${i + 1}/${chunks.length})`,
            content: chunk,
            category: category,
            summary: summary || null,
            embedding: embeddingData.embedding
          });

        if (insertError) {
          console.error(`Database insert error for chunk ${i + 1}:`, insertError);
          errorCount++;
          continue;
        }

        console.log(`Chunk ${i + 1} inserted successfully`);
        successCount++;

      } catch (chunkError) {
        console.error(`Error processing chunk ${i + 1}:`, chunkError);
        errorCount++;
      }
    }

    console.log(`Processing complete: ${successCount} successful, ${errorCount} failed`);

    if (successCount === 0) {
      throw new Error('Failed to process any chunks');
    }

    return new Response(
      JSON.stringify({
        success: true,
        chunks: successCount,
        errors: errorCount,
        total: chunks.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('=== ERROR IN PROCESS-CHUNKS ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    return new Response(
      JSON.stringify({
        error: error.message || 'Unknown error',
        details: error.stack
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
