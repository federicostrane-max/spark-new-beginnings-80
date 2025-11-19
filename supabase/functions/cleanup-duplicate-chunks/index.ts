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

    console.log('Executing consolidate_pool_chunks...');

    // Execute the consolidation function
    const { data, error } = await supabaseClient.rpc('consolidate_pool_chunks');

    if (error) {
      console.error('Error executing consolidate_pool_chunks:', error);
      throw error;
    }

    console.log('Consolidation completed:', data);

    // Calculate totals
    const totalDocuments = data?.length || 0;
    const totalDuplicatesRemoved = data?.reduce((sum: number, doc: any) => sum + (doc.duplicates_removed || 0), 0) || 0;
    const totalChunksBefore = data?.reduce((sum: number, doc: any) => sum + (doc.chunks_before || 0), 0) || 0;
    const totalChunksAfter = data?.reduce((sum: number, doc: any) => sum + (doc.chunks_after || 0), 0) || 0;

    return new Response(
      JSON.stringify({
        success: true,
        results: {
          documentsProcessed: totalDocuments,
          duplicatesRemoved: totalDuplicatesRemoved,
          chunksBefore: totalChunksBefore,
          chunksAfter: totalChunksAfter,
          details: data
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
