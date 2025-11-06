import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  documentId: string;
  agentId: string;
}

/**
 * Converts ArrayBuffer to base64 in chunks to avoid stack overflow
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks
  let result = '';
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    result += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(result);
}

/**
 * Chunka il testo in blocchi di dimensione fissa con overlap
 */
function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + chunkSize, text.length);
    const chunk = text.slice(startIndex, endIndex);
    
    if (chunk.trim().length > 0) {
      chunks.push(chunk.trim());
    }

    // Move forward by (chunkSize - overlap) to create overlap
    startIndex += (chunkSize - overlap);
  }

  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, agentId }: SyncRequest = await req.json();

    console.log(`[sync-pool-document] Starting sync for document ${documentId} to agent ${agentId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ========================================
    // STEP 1: Get document from pool
    // ========================================
    const { data: poolDoc, error: docError } = await supabase
      .from('knowledge_documents')
      .select('*')
      .eq('id', documentId)
      .eq('processing_status', 'ready_for_assignment')
      .maybeSingle();

    if (docError) throw docError;
    if (!poolDoc) {
      throw new Error(`Document ${documentId} not found or not validated`);
    }

    console.log(`[sync-pool-document] Found document: ${poolDoc.file_name}`);

    // ========================================
    // STEP 2: CRITICAL - Create/Verify agent_document_links and mark as 'syncing'
    // ========================================
    console.log('[sync-pool-document] Creating/verifying agent_document_links...');
    
    const { error: linkError } = await supabase
      .from('agent_document_links')
      .upsert({
        agent_id: agentId,
        document_id: documentId,
        assignment_type: 'ai_assigned',
        confidence_score: 1.0,
        sync_status: 'syncing',
        sync_started_at: new Date().toISOString(),
        sync_error: null
      }, { 
        onConflict: 'agent_id,document_id',
        ignoreDuplicates: false
      });

    if (linkError) {
      console.error('[sync-pool-document] Failed to create agent_document_link:', linkError);
      throw new Error(`Failed to create document link: ${linkError.message}`);
    }

    console.log('[sync-pool-document] ✓ Agent document link guaranteed, sync status: syncing');

    // ========================================
    // STEP 3: Check if already synced
    // ========================================
    const { data: existingChunks } = await supabase
      .from('agent_knowledge')
      .select('id')
      .eq('agent_id', agentId)
      .eq('pool_document_id', documentId)
      .eq('source_type', 'shared_pool');

    if (existingChunks && existingChunks.length > 0) {
      console.log(`[sync-pool-document] Document already synced (${existingChunks.length} chunks)`);
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Already synced',
        chunksCount: existingChunks.length 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // STEP 4: Copy ALL existing chunks for this document
    // ========================================
    console.log('[sync-pool-document] Looking for existing chunks (any agent or shared pool)...');
    
    // First check if ANY chunks exist for this document
    const { data: sampleChunks, error: sampleError } = await supabase
      .from('agent_knowledge')
      .select('id')
      .eq('pool_document_id', documentId)
      .limit(1);

    if (sampleError) {
      console.error('[sync-pool-document] Error checking for chunks:', sampleError);
      throw sampleError;
    }

    if (sampleChunks && sampleChunks.length > 0) {
      console.log('[sync-pool-document] Document has chunks, fetching ALL for copy...');
      
      // Fetch ALL chunks for this document (from any source)
      const { data: allChunks, error: allChunksError } = await supabase
        .from('agent_knowledge')
        .select('document_name, content, category, summary, embedding')
        .eq('pool_document_id', documentId);

      if (allChunksError) {
        console.error('[sync-pool-document] Error fetching all chunks:', allChunksError);
        throw allChunksError;
      }

      console.log(`[sync-pool-document] Found ${allChunks?.length || 0} total chunks to copy`);

      // Copy ALL chunks and assign to agent
      const chunksToInsert = (allChunks || []).map(chunk => ({
        agent_id: agentId,
        document_name: chunk.document_name,
        content: chunk.content,
        category: chunk.category || 'General',
        summary: chunk.summary || `Part of ${poolDoc.file_name}`,
        embedding: chunk.embedding,
        source_type: 'shared_pool',
        pool_document_id: documentId,
      }));

      // Insert in batches to avoid timeout with large documents
      const BATCH_SIZE = 50;
      let totalInserted = 0;
      
      for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
        const batch = chunksToInsert.slice(i, i + BATCH_SIZE);
        console.log(`[sync-pool-document] Inserting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunksToInsert.length / BATCH_SIZE)} (${batch.length} chunks)`);
        
        const { error: insertError } = await supabase
          .from('agent_knowledge')
          .insert(batch);

        if (insertError) {
          console.error('[sync-pool-document] Error copying batch:', insertError);
          throw insertError;
        }
        
        totalInserted += batch.length;
      }

      console.log(`[sync-pool-document] ✓ Successfully copied ${totalInserted} chunks to agent`);

      // Mark sync as completed
      await supabase
        .from('agent_document_links')
        .update({
          sync_status: 'completed',
          sync_completed_at: new Date().toISOString(),
          sync_error: null
        })
        .eq('agent_id', agentId)
        .eq('document_id', documentId);

      return new Response(JSON.stringify({ 
        success: true,
        chunksCount: totalInserted,
        totalChunks: totalInserted,
        method: 'copied_all_chunks'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[sync-pool-document] No existing chunks found, falling back to PDF processing...');

    // ========================================
    // STEP 5: FALLBACK - Download and extract text from PDF
    // ========================================
    console.log(`[sync-pool-document] Downloading PDF from bucket: knowledge-pdfs, path: ${poolDoc.file_path}`);
    
    // Remove bucket name if it's included in the path
    let cleanPath = poolDoc.file_path;
    if (cleanPath.startsWith('knowledge-pdfs/')) {
      cleanPath = cleanPath.replace('knowledge-pdfs/', '');
    }
    
    console.log(`[sync-pool-document] Clean path: ${cleanPath}`);
    
    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('knowledge-pdfs')
      .download(cleanPath);

    if (downloadError || !fileData) {
      console.error('[sync-pool-document] Download error:', downloadError);
      
      // Mark document as having a missing/inaccessible file
      await supabase
        .from('knowledge_documents')
        .update({ 
          processing_status: 'error',
          validation_status: 'rejected',
          validation_reason: `Failed to download file: ${downloadError?.message || 'File not found'}. The file may have been moved or deleted.`
        })
        .eq('id', documentId);
      
      throw new Error(`Failed to download PDF: ${downloadError?.message || 'File not found'}`);
    }

    // Use extract-pdf-text edge function with documentId
    console.log('[sync-pool-document] Extracting text from PDF...');
    
    const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-pdf-text', {
      body: { 
        documentId: documentId
      }
    });

    if (extractError) {
      console.error('[sync-pool-document] Text extraction failed:', extractError);
      throw new Error(`Text extraction failed: ${extractError.message}`);
    }

    const fullText = extractData?.text || '';

    if (!fullText || fullText.trim().length < 100) {
      throw new Error(`Extracted text too short or empty (${fullText.length} chars). PDF may be scanned or corrupted.`);
    }

    console.log(`[sync-pool-document] Extracted ${fullText.length} characters`);

    // ========================================
    // STEP 6: Chunk the text
    // ========================================
    const chunks = chunkText(fullText, 1000, 200);
    console.log(`[sync-pool-document] Created ${chunks.length} chunks`);

    // ========================================
    // STEP 7: Generate embeddings and insert chunks
    // ========================================
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    let insertedCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      console.log(`[sync-pool-document] Processing chunk ${i + 1}/${chunks.length}`);

      // Generate embedding with newer model
      const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: chunk,
        }),
      });

      if (!embeddingResponse.ok) {
        console.error(`[sync-pool-document] Failed to generate embedding for chunk ${i + 1}`);
        continue;
      }

      const embeddingData = await embeddingResponse.json();
      const embedding = embeddingData.data[0].embedding;

      // Insert chunk into agent_knowledge
      const { error: insertError } = await supabase
        .from('agent_knowledge')
        .insert({
          agent_id: agentId,
          document_name: poolDoc.file_name,
          content: chunk,
          category: poolDoc.topics?.[0] || 'General',
          summary: poolDoc.ai_summary || `Part ${i + 1} of ${poolDoc.file_name}`,
          embedding: embedding,
          source_type: 'shared_pool',
          pool_document_id: documentId,
        });

      if (insertError) {
        console.error(`[sync-pool-document] Failed to insert chunk ${i + 1}:`, insertError);
      } else {
        insertedCount++;
      }
    }

    console.log(`[sync-pool-document] Successfully inserted ${insertedCount}/${chunks.length} chunks`);

    // Mark sync as completed
    await supabase
      .from('agent_document_links')
      .update({
        sync_status: 'completed',
        sync_completed_at: new Date().toISOString(),
        sync_error: null
      })
      .eq('agent_id', agentId)
      .eq('document_id', documentId);

    return new Response(JSON.stringify({ 
      success: true,
      chunksCount: insertedCount,
      totalChunks: chunks.length,
      method: 'processed_pdf'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[sync-pool-document] Error:', error);
    
    // Mark sync as failed (try to extract documentId and agentId from request)
    try {
      const requestClone = req.clone();
      const { documentId, agentId } = await requestClone.json();
      
      if (documentId && agentId) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        await supabase
          .from('agent_document_links')
          .update({
            sync_status: 'failed',
            sync_error: error instanceof Error ? error.message : 'Sync error'
          })
          .eq('agent_id', agentId)
          .eq('document_id', documentId);
      }
    } catch (updateError) {
      console.error('[sync-pool-document] Failed to update sync_status to failed:', updateError);
    }
    
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Sync error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
