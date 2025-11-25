import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Delete the specific orphan file from Pipeline C storage
    const orphanPath = 'e27af09a-507d-4acc-885c-d3ac98af382b/The_Extreme_Searchers_Internet_Handbook_A_Guide_f.pdf';
    
    console.log(`[CLEANUP] Attempting to delete orphan file: ${orphanPath}`);
    
    const { error: storageError } = await supabase.storage
      .from('pipeline-c-uploads')
      .remove([orphanPath]);

    if (storageError) {
      console.error('[CLEANUP] Storage deletion error:', storageError);
      throw storageError;
    }

    console.log('[CLEANUP] ✓ Orphan file deleted successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Orphan file deleted',
        path: orphanPath
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[CLEANUP] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
