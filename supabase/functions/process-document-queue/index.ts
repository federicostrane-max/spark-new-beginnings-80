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

    const { batchSize = 10 } = await req.json().catch(() => ({}));
    
    console.log(`🔄 Processing queue with batch size: ${batchSize}`);

    // Prendi N documenti pending dalla coda
    const { data: queueItems, error: queueError } = await supabase
      .from('document_processing_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', 3) // Max 3 tentativi
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (queueError) throw queueError;
    
    if (!queueItems || queueItems.length === 0) {
      console.log('✅ No pending items in queue');
      return new Response(
        JSON.stringify({ processed: 0, message: 'Queue is empty' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Found ${queueItems.length} items to process`);

    const results = { processed: 0, failed: 0, errors: [] as string[] };

    for (const item of queueItems) {
      try {
        // Marca come processing
        await supabase
          .from('document_processing_queue')
          .update({ 
            status: 'processing', 
            started_at: new Date().toISOString(),
            attempts: item.attempts + 1
          })
          .eq('id', item.id);

        // Chiama la funzione appropriata
        const functionName = item.processing_type === 'extract' 
          ? 'process-document' 
          : 'validate-document';

        console.log(`🔧 Processing ${item.document_id} with ${functionName}`);

        const { error: processError } = await supabase.functions.invoke(functionName, {
          body: { documentId: item.document_id }
        });

        if (processError) throw processError;

        // ✅ NEW: Verify chunks were created for extract operations (SHARED POOL + ACTIVE)
        if (item.processing_type === 'extract') {
          console.log(`✓ Verifying SHARED POOL chunks for ${item.document_id}...`);
          const { data: chunks, error: checkError } = await supabase
            .from('agent_knowledge')
            .select('id')
            .eq('pool_document_id', item.document_id)
            .is('agent_id', null)       // ✅ FIX: Only shared pool chunks
            .eq('is_active', true)       // ✅ FIX: Only active chunks
            .limit(1);
          
          if (checkError) {
            throw new Error(`Chunk verification failed: ${checkError.message}`);
          }
          
          if (!chunks || chunks.length === 0) {
            throw new Error('Chunk creation failed: no SHARED POOL chunks found after processing');
          }
          
          console.log(`✓ Shared pool chunks verified for ${item.document_id}`);
        }

        // Marca come completed
        await supabase
          .from('document_processing_queue')
          .update({ 
            status: 'completed', 
            completed_at: new Date().toISOString(),
            error_message: null
          })
          .eq('id', item.id);

        results.processed++;
        console.log(`✅ Processed ${item.document_id}`);

      } catch (error: any) {
        results.failed++;
        results.errors.push(`${item.document_id}: ${error.message}`);
        
        console.error(`❌ Failed ${item.document_id}:`, error.message);

        // Se ha raggiunto max attempts, marca come failed
        const newAttempts = item.attempts + 1;
        if (newAttempts >= 3) {
          await supabase
            .from('document_processing_queue')
            .update({ 
              status: 'failed',
              error_message: error.message,
              completed_at: new Date().toISOString()
            })
            .eq('id', item.id);
        } else {
          // Rimetti in pending per retry
          await supabase
            .from('document_processing_queue')
            .update({ 
              status: 'pending',
              error_message: error.message
            })
            .eq('id', item.id);
        }
      }
    }

    console.log(`✅ Batch complete: ${results.processed} processed, ${results.failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        message: `Processed ${results.processed}/${queueItems.length} documents`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Queue processing error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
