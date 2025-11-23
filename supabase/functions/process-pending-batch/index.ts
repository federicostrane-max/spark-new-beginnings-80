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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log('[process-pending-batch] Starting batch processing of pending documents...');

    // Get all pending documents
    const { data: pending, error: fetchError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, folder')
      .eq('processing_status', 'pending_processing')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('[process-pending-batch] Error fetching pending documents:', fetchError);
      throw fetchError;
    }

    if (!pending || pending.length === 0) {
      console.log('[process-pending-batch] No pending documents found');
      return new Response(
        JSON.stringify({ processed: 0, total: 0, message: 'No pending documents' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[process-pending-batch] Found ${pending.length} documents to process`);

    let processed = 0;
    let failed = 0;
    const errors: any[] = [];

    // Process documents in small batches to avoid timeout
    const batchSize = 5;
    for (let i = 0; i < pending.length && i < 30; i += batchSize) {
      const batch = pending.slice(i, Math.min(i + batchSize, pending.length, 30));
      console.log(`[process-pending-batch] Processing batch ${Math.floor(i / batchSize) + 1}, documents ${i + 1}-${Math.min(i + batchSize, 30)}`);

      // Process batch in parallel
      const batchPromises = batch.map(async (doc) => {
        try {
          console.log(`[process-pending-batch] Processing: ${doc.file_name}`);
          
          const { error: processError } = await supabase.functions.invoke('process-document', {
            body: { documentId: doc.id }
          });

          if (processError) {
            console.error(`[process-pending-batch] Failed to process ${doc.file_name}:`, processError);
            failed++;
            errors.push({ file_name: doc.file_name, error: processError.message });
          } else {
            console.log(`[process-pending-batch] ✅ Processed: ${doc.file_name}`);
            processed++;
          }
        } catch (err) {
          console.error(`[process-pending-batch] Exception processing ${doc.file_name}:`, err);
          failed++;
          errors.push({ file_name: doc.file_name, error: String(err) });
        }
      });

      await Promise.all(batchPromises);

      // Small delay between batches
      if (i + batchSize < Math.min(pending.length, 30)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`[process-pending-batch] Batch processing complete: ${processed} processed, ${failed} failed`);

    return new Response(
      JSON.stringify({
        processed,
        failed,
        total: pending.length,
        processedLimit: 30,
        errors: errors.slice(0, 10) // First 10 errors
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[process-pending-batch] Fatal error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        processed: 0,
        failed: 0
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
