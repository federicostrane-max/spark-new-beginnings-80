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

    if (!agentId || !fileName) {
      throw new Error('agentId and fileName are required');
    }

    console.log(`Starting background processing of ${chunks.length} chunks for agent ${agentId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Define background task to process chunks in small batches
    const processChunksInBackground = async () => {
      const BATCH_SIZE = 15; // Process 15 chunks at a time
      let successCount = 0;
      let errorCount = 0;

      console.log(`Background task started: Processing ${chunks.length} chunks in batches of ${BATCH_SIZE}`);

      // Process in batches sequentially
      for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
        const batch = chunks.slice(batchStart, batchEnd);
        const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

        console.log(`\n=== Processing batch ${batchNum}/${totalBatches} (chunks ${batchStart + 1}-${batchEnd}) ===`);

        // Process chunks in this batch in parallel
        const batchPromises = batch.map(async (chunk: string, i: number) => {
          const globalIndex = batchStart + i;
          
          try {
            // Generate embedding
            const { data: embeddingData, error: embeddingError } = await supabase.functions.invoke(
              'generate-embedding',
              { body: { text: chunk } }
            );

            if (embeddingError || !embeddingData?.embedding) {
              console.error(`Embedding failed for chunk ${globalIndex + 1}:`, embeddingError);
              return { success: false };
            }

            // Insert chunk into database
            const { error: insertError } = await supabase
              .from('agent_knowledge')
              .insert({
                agent_id: agentId,
                document_name: fileName,
                content: chunk,
                category: category || 'General',
                summary: summary || null,
                embedding: embeddingData.embedding
              });

            if (insertError) {
              console.error(`Insert failed for chunk ${globalIndex + 1}:`, insertError);
              return { success: false };
            }

            console.log(`✓ Chunk ${globalIndex + 1} processed successfully`);
            return { success: true };

          } catch (chunkError) {
            console.error(`Error processing chunk ${globalIndex + 1}:`, chunkError);
            return { success: false };
          }
        });

        // Wait for this batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Count results for this batch
        batchResults.forEach(result => {
          if (result.success) {
            successCount++;
          } else {
            errorCount++;
          }
        });

        console.log(`Batch ${batchNum} complete: ${batchResults.filter(r => r.success).length}/${batch.length} successful`);
        console.log(`Overall progress: ${successCount + errorCount}/${chunks.length} chunks processed (${successCount} success, ${errorCount} errors)`);

        // Small delay between batches to avoid overwhelming the system
        if (batchEnd < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log(`\n=== BACKGROUND PROCESSING COMPLETE ===`);
      console.log(`File: ${fileName}`);
      console.log(`Total chunks: ${chunks.length}`);
      console.log(`Successful: ${successCount}`);
      console.log(`Failed: ${errorCount}`);
      console.log(`Success rate: ${((successCount / chunks.length) * 100).toFixed(1)}%`);
    };

    // Start background processing (non-blocking)
    // @ts-ignore - EdgeRuntime is available in Deno deploy
    if (typeof EdgeRuntime !== 'undefined') {
      // @ts-ignore
      EdgeRuntime.waitUntil(processChunksInBackground());
    } else {
      // Fallback for local testing - just await it
      await processChunksInBackground();
    }

    // Return immediate response to client
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Processing started in background',
        totalChunks: chunks.length,
        fileName: fileName,
        estimatedTime: `${Math.ceil(chunks.length / 15)} batches (~${Math.ceil(chunks.length / 15 * 3)} seconds)`
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
