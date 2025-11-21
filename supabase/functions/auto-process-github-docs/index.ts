import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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

    console.log('🤖 Auto-trigger: Checking for unprocessed GitHub documents...');

    // Check if there are 'downloaded' GitHub documents waiting
    const { data: pendingDocs, error } = await supabase
      .from('knowledge_documents')
      .select('folder')
      .eq('processing_status', 'downloaded')
      .like('folder', '%GitHub%')
      .limit(1);

    if (error) throw error;

    if (!pendingDocs || pendingDocs.length === 0) {
      console.log('✅ No pending GitHub documents to process');
      return new Response(
        JSON.stringify({ 
          success: true, 
          triggered: false,
          message: 'No GitHub documents pending processing' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Trigger batch processing
    console.log('🚀 Triggering process-github-batch...');
    const { data, error: invokeError } = await supabase.functions.invoke('process-github-batch', {
      body: { batchSize: 50 }
    });

    if (invokeError) {
      console.error('❌ Failed to trigger batch processing:', invokeError);
      throw invokeError;
    }

    console.log('✅ Batch processing triggered successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        triggered: true,
        message: 'GitHub batch processing triggered',
        result: data
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Auto-trigger error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
