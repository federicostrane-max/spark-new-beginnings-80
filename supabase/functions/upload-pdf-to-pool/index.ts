import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  
  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, fileName, agentId, fileSize } = await req.json();
    
    console.log('=== UPLOAD PDF TO POOL ===');
    console.log(`File: ${fileName}`);
    console.log(`Agent: ${agentId}`);
    console.log(`Text length: ${text?.length || 0} chars`);
    console.log(`File size: ${fileSize || 0} bytes`);

    if (!text || !fileName || !agentId) {
      throw new Error('Missing required parameters: text, fileName, or agentId');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Create document in knowledge_documents
    console.log('[STEP 1] Creating document in knowledge_documents...');
    
    const { data: document, error: docError } = await supabase
      .from('knowledge_documents')
      .insert({
        file_name: fileName,
        file_path: `pool-uploads/${agentId}/${fileName}`,
        validation_status: 'validated',
        processing_status: 'processing',
        text_length: text.length,
        file_size_bytes: fileSize || null,
      })
      .select('id')
      .single();

    if (docError) {
      console.error('[STEP 1 ERROR]', docError);
      throw docError;
    }

    const documentId = document.id;
    console.log(`[STEP 1] ✓ Document created (id: ${documentId})`);

    // ⚠️ CRITICAL WORKFLOW NOTE:
    // This function is for DIRECT UPLOADS by a specific agent.
    // It creates a 'manual' link to assign the document to the uploading agent.
    // For documents downloaded via search (download-pdf-tool), they should go to
    // the SHARED POOL without any agent assignment.
    // NEVER use 'ai_assigned' - only 'manual' or no link at all for shared pool.
    
    // Step 2: Create agent_document_links (manual assignment for direct upload)
    console.log('[STEP 2] Creating agent_document_links (manual assignment)...');
    
    const { error: linkError } = await supabase
      .from('agent_document_links')
      .insert({
        document_id: documentId,
        agent_id: agentId,
        assignment_type: 'manual', // ✅ ALWAYS 'manual' for direct uploads
        confidence_score: 1.0,
      });

    if (linkError) {
      console.error('[STEP 2 ERROR]', linkError);
      throw linkError;
    }

    console.log('[STEP 2] ✓ Agent link created');

    // Step 3: Chunk the text
    console.log('[STEP 3] Chunking text...');
    const chunks = chunkText(text, 1000, 200);
    console.log(`[STEP 3] ✓ Created ${chunks.length} chunks`);

    // Step 4: Process chunks in batches (generate embeddings and insert)
    console.log('[STEP 4] Processing chunks with embeddings...');
    
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const BATCH_SIZE = 10;
    let processedChunks = 0;
    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const batch = chunks.slice(i, i + BATCH_SIZE);
      
      console.log(`[BATCH ${batchNumber}/${totalBatches}] Processing ${batch.length} chunks...`);

      // Generate embeddings for batch
      const embeddingPromises = batch.map(async (chunk) => {
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-ada-002',
            input: chunk,
          }),
        });

        if (!embeddingResponse.ok) {
          throw new Error(`Failed to generate embedding: ${embeddingResponse.statusText}`);
        }

        const embeddingData = await embeddingResponse.json();
        return {
          content: chunk,
          embedding: embeddingData.data[0].embedding,
        };
      });

      const chunksWithEmbeddings = await Promise.all(embeddingPromises);

      // Insert chunks into agent_knowledge
      const { error: insertError } = await supabase
        .from('agent_knowledge')
        .insert(
          chunksWithEmbeddings.map((chunk) => ({
            agent_id: agentId,
            document_name: fileName,
            content: chunk.content,
            embedding: chunk.embedding,
            category: 'General',
            source_type: 'shared_pool',
            pool_document_id: documentId,
          }))
        );

      if (insertError) {
        console.error(`[BATCH ${batchNumber} ERROR]`, insertError);
        throw insertError;
      }

      processedChunks += batch.length;
      console.log(`[BATCH ${batchNumber}/${totalBatches}] ✓ Inserted ${batch.length} chunks (total: ${processedChunks}/${chunks.length})`);

      // Small delay between batches
      if (i + BATCH_SIZE < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[STEP 4] ✓ All ${processedChunks} chunks processed and inserted`);

    // Step 5: Trigger AI analysis (optional - call process-document)
    console.log('[STEP 5] Triggering AI analysis...');
    
    try {
      const { error: processError } = await supabase.functions.invoke('process-document', {
        body: {
          documentId,
          fullText: text,
        },
      });

      if (processError) {
        console.warn('[STEP 5 WARNING] AI analysis failed (non-critical):', processError);
      } else {
        console.log('[STEP 5] ✓ AI analysis triggered');
      }
    } catch (analysisError) {
      console.warn('[STEP 5 WARNING] AI analysis failed (non-critical):', analysisError);
    }

    // Step 6: Update processing status
    console.log('[STEP 6] Updating document status...');
    
    const { error: updateError } = await supabase
      .from('knowledge_documents')
      .update({ processing_status: 'ready_for_assignment' })
      .eq('id', documentId);

    if (updateError) {
      console.error('[STEP 6 ERROR]', updateError);
      throw updateError;
    }

    console.log('[STEP 6] ✓ Document status updated to ready_for_assignment');

    console.log('=== UPLOAD COMPLETE ===');
    console.log(`Document ID: ${documentId}`);
    console.log(`Chunks processed: ${processedChunks}`);
    console.log(`Auto-assigned to agent: ${agentId}`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        chunksProcessed: processedChunks,
        message: `PDF uploaded to pool and assigned to agent`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('=== UPLOAD FAILED ===', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
