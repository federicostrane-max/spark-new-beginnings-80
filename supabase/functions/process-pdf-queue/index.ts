import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessQueueRequest {
  conversationId: string;
  maxConcurrent?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { conversationId, maxConcurrent = 3 }: ProcessQueueRequest = await req.json();
    
    console.log(`📥 [QUEUE PROCESSOR] Starting for conversation: ${conversationId}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get pending PDFs from queue
    const { data: pendingPdfs, error: fetchError } = await supabase
      .from('pdf_download_queue')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('status', 'pending')
      .order('created_at');
    
    if (fetchError) {
      console.error('❌ Failed to fetch queue:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch queue', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!pendingPdfs || pendingPdfs.length === 0) {
      console.log('ℹ️ No pending PDFs in queue');
      return new Response(
        JSON.stringify({ message: 'No pending PDFs', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`📋 Found ${pendingPdfs.length} pending PDFs`);
    
    let processed = 0;
    let failed = 0;
    
    // Process PDFs in batches to avoid overwhelming the system
    for (let i = 0; i < pendingPdfs.length; i += maxConcurrent) {
      const batch = pendingPdfs.slice(i, i + maxConcurrent);
      
      console.log(`\n🔄 Processing batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(pendingPdfs.length / maxConcurrent)}`);
      
      const batchPromises = batch.map(async (queueItem) => {
        try {
          console.log(`  📥 Downloading: ${queueItem.expected_title}`);
          
          // Update status to downloading
          await supabase
            .from('pdf_download_queue')
            .update({ 
              status: 'downloading', 
              started_at: new Date().toISOString(),
              download_attempts: queueItem.download_attempts + 1
            })
            .eq('id', queueItem.id);
          
          // Call download-pdf-tool
          const { data: downloadData, error: downloadError } = await supabase.functions.invoke(
            'download-pdf-tool',
            {
              body: {
                url: queueItem.url,
                search_query: queueItem.search_query,
                expected_title: queueItem.expected_title,
                expected_author: queueItem.expected_author
              }
            }
          );
          
          if (downloadError) {
            console.error(`  ❌ Download failed:`, downloadError);
            
            // Update queue status to failed
            await supabase
              .from('pdf_download_queue')
              .update({ 
                status: 'failed',
                error_message: downloadError.message || 'Download failed',
                completed_at: new Date().toISOString()
              })
              .eq('id', queueItem.id);
            
            failed++;
            return { success: false, title: queueItem.expected_title };
          }
          
          // Update queue status to processing (document will be validated and processed)
          await supabase
            .from('pdf_download_queue')
            .update({ 
              status: 'processing',
              document_id: downloadData.document_id,
              validation_result: downloadData
            })
            .eq('id', queueItem.id);
          
          console.log(`  ✅ Queued for processing: ${queueItem.expected_title}`);
          processed++;
          return { success: true, title: queueItem.expected_title };
          
        } catch (error) {
          console.error(`  ❌ Error processing ${queueItem.expected_title}:`, error);
          
          await supabase
            .from('pdf_download_queue')
            .update({ 
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              completed_at: new Date().toISOString()
            })
            .eq('id', queueItem.id);
          
          failed++;
          return { success: false, title: queueItem.expected_title };
        }
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches
      if (i + maxConcurrent < pendingPdfs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`\n✅ [QUEUE PROCESSOR] Completed`);
    console.log(`   Processed: ${processed}`);
    console.log(`   Failed: ${failed}`);
    
    return new Response(
      JSON.stringify({ 
        success: true,
        total: pendingPdfs.length,
        processed,
        failed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('❌ [QUEUE PROCESSOR] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});