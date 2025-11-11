import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

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

    console.log('[Reset Queue] Starting reset of stuck PDFs...');

    // Find stuck PDFs: status='downloading' AND document_id IS NULL
    const { data: stuckPdfs, error: findError } = await supabase
      .from('pdf_download_queue')
      .select('id, expected_title, conversation_id, download_attempts')
      .eq('status', 'downloading')
      .is('document_id', null);

    if (findError) {
      console.error('[Reset Queue] Error finding stuck PDFs:', findError);
      throw findError;
    }

    if (!stuckPdfs || stuckPdfs.length === 0) {
      console.log('[Reset Queue] No stuck PDFs found');
      return new Response(
        JSON.stringify({ 
          success: true, 
          resetCount: 0,
          conversationIds: [],
          message: 'No stuck PDFs found'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Reset Queue] Found ${stuckPdfs.length} stuck PDFs:`, 
      stuckPdfs.map(p => p.expected_title).join(', '));

    // Reset each stuck PDF
    const pdfIds = stuckPdfs.map(p => p.id);
    const { error: updateError } = await supabase
      .from('pdf_download_queue')
      .update({
        status: 'pending',
        started_at: null,
        download_attempts: 0, // Reset attempts to give fresh start
        error_message: null
      })
      .in('id', pdfIds);

    if (updateError) {
      console.error('[Reset Queue] Error resetting PDFs:', updateError);
      throw updateError;
    }

    // Get unique conversation IDs
    const conversationIds = [...new Set(stuckPdfs.map(p => p.conversation_id))];

    console.log(`[Reset Queue] Successfully reset ${stuckPdfs.length} PDFs`);
    console.log(`[Reset Queue] Affected conversations:`, conversationIds);

    return new Response(
      JSON.stringify({ 
        success: true, 
        resetCount: stuckPdfs.length,
        conversationIds,
        resetPdfs: stuckPdfs.map(p => ({
          id: p.id,
          title: p.expected_title,
          conversationId: p.conversation_id
        }))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Reset Queue] Fatal error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        resetCount: 0,
        conversationIds: []
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
