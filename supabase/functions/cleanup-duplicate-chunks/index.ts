import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log('cleanup-duplicate-chunks function started');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );

    // Verify user is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const BATCH_SIZE = 3;
    let allResults: any[] = [];
    let hasMore = true;
    let totalProcessed = 0;

    console.log('Starting batch consolidation...');

    // Process in batches until no more documents to process
    while (hasMore) {
      console.log(`Processing batch starting at document ${totalProcessed}...`);
      
      const { data, error } = await supabaseClient.rpc('consolidate_pool_chunks_batch', {
        batch_limit: BATCH_SIZE
      });

      if (error) {
        console.error('Error executing consolidate_pool_chunks_batch:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        console.log('No more documents to process');
      } else {
        allResults = [...allResults, ...data];
        totalProcessed += data.length;
        console.log(`Batch completed: ${data.length} documents processed. Total: ${totalProcessed}`);
        
        // If we got fewer results than the batch size, we're done
        if (data.length < BATCH_SIZE) {
          hasMore = false;
        }
      }
    }

    console.log('Consolidation completed. Total documents:', totalProcessed);

    // Calculate totals
    const totalDuplicatesRemoved = allResults.reduce((sum: number, doc: any) => sum + (doc.duplicates_removed || 0), 0);
    const totalChunksBefore = allResults.reduce((sum: number, doc: any) => sum + (doc.chunks_before || 0), 0);
    const totalChunksAfter = allResults.reduce((sum: number, doc: any) => sum + (doc.chunks_after || 0), 0);

    return new Response(
      JSON.stringify({
        success: true,
        results: {
          documentsProcessed: totalProcessed,
          duplicatesRemoved: totalDuplicatesRemoved,
          chunksBefore: totalChunksBefore,
          chunksAfter: totalChunksAfter,
          details: allResults
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in cleanup-duplicate-chunks:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
