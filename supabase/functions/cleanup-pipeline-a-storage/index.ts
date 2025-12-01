import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Cleanup Storage] Starting cleanup of pipeline-a-uploads bucket');

    // List all files in pipeline-a-uploads bucket
    const { data: files, error: listError } = await supabase
      .storage
      .from('pipeline-a-uploads')
      .list();

    if (listError) {
      console.error('[Cleanup Storage] Error listing files:', listError);
      throw listError;
    }

    if (!files || files.length === 0) {
      console.log('[Cleanup Storage] No files to delete');
      return new Response(
        JSON.stringify({ success: true, deletedCount: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Cleanup Storage] Found ${files.length} files to delete`);

    // Delete all files
    const filePaths = files.map(file => file.name);
    const { data: deleteData, error: deleteError } = await supabase
      .storage
      .from('pipeline-a-uploads')
      .remove(filePaths);

    if (deleteError) {
      console.error('[Cleanup Storage] Error deleting files:', deleteError);
      throw deleteError;
    }

    console.log(`[Cleanup Storage] ✅ Successfully deleted ${filePaths.length} files`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        deletedCount: filePaths.length,
        message: `Deleted ${filePaths.length} files from pipeline-a-uploads bucket`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Cleanup Storage] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
