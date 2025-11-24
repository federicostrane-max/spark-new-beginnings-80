import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LandingAIChunk {
  text: string;
  chunk_type: 'text' | 'table' | 'chart' | 'list' | 'header' | 'footer' | 'image';
  chunk_references: {
    page_number: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[];
}

async function extractWithLandingAI(fileBase64: string, fileName: string): Promise<LandingAIChunk[]> {
  const landingApiKey = Deno.env.get('LANDING_AI_API_KEY');
  if (!landingApiKey) {
    throw new Error('LANDING_AI_API_KEY not configured');
  }

  // Convert base64 to binary
  const binaryData = Uint8Array.from(atob(fileBase64), c => c.charCodeAt(0));
  
  // Create form data
  const formData = new FormData();
  const blob = new Blob([binaryData], { type: 'application/pdf' });
  formData.append('file', blob, fileName);

  console.log(`[LANDING AI] Sending ${fileName} for extraction...`);
  
  const response = await fetch('https://api.landing.ai/v1/agentic-document-extraction/extract', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${landingApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[LANDING AI ERROR]', response.status, errorText);
    throw new Error(`Landing AI extraction failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  console.log(`[LANDING AI] ✓ Extracted ${result.chunks?.length || 0} chunks`);
  
  return result.chunks || [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileBase64, fileName, agentId, fileSize } = await req.json();
    
    console.log('=== UPLOAD PDF TO POOL (Landing AI) ===');
    console.log(`File: ${fileName}`);
    console.log(`Agent: ${agentId || 'SHARED POOL (no agent)'}`);
    console.log(`File size: ${fileSize || 0} bytes`);

    if (!fileBase64 || !fileName) {
      throw new Error('Missing required parameters: fileBase64 or fileName');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Create document in knowledge_documents
    console.log('[STEP 1] Creating document in knowledge_documents...');
    
    // Extract chunks using Landing AI
    const chunks = await extractWithLandingAI(fileBase64, fileName);
    const totalTextLength = chunks.reduce((sum, c) => sum + c.text.length, 0);

    const { data: document, error: docError } = await supabase
      .from('knowledge_documents')
      .insert({
        file_name: fileName,
        file_path: `pool-uploads/${agentId}/${fileName}`,
        validation_status: 'validated',
        processing_status: 'processing',
        text_length: totalTextLength,
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

    // Step 2: Create agent_document_links ONLY if agentId is provided
    if (agentId) {
      console.log('[STEP 2] Creating agent_document_links (manual assignment)...');
      
      const { error: linkError } = await supabase
        .from('agent_document_links')
        .insert({
          document_id: documentId,
          agent_id: agentId,
          assignment_type: 'manual',
          confidence_score: 1.0,
        });

      if (linkError) {
        console.error('[STEP 2 ERROR]', linkError);
        throw linkError;
      }

      console.log('[STEP 2] ✓ Agent link created');
    } else {
      console.log('[STEP 2] ⊗ Skipped agent link creation (shared pool upload)');
    }

    console.log(`[STEP 3] ✓ Landing AI extracted ${chunks.length} chunks`);

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
      const embeddingPromises = batch.map(async (chunk: LandingAIChunk) => {
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: chunk.text,
          }),
        });

        if (!embeddingResponse.ok) {
          throw new Error(`Failed to generate embedding: ${embeddingResponse.statusText}`);
        }

        const embeddingData = await embeddingResponse.json();
        return {
          content: chunk.text,
          embedding: embeddingData.data[0].embedding,
          chunk_type: chunk.chunk_type,
          visual_grounding: chunk.chunk_references,
        };
      });

      const chunksWithEmbeddings = await Promise.all(embeddingPromises);

      // Insert chunks into agent_knowledge
      const { error: insertError } = await supabase
        .from('agent_knowledge')
        .insert(
          chunksWithEmbeddings.map((chunk) => ({
            agent_id: null, // Always NULL for shared pool
            document_name: fileName,
            content: chunk.content,
            embedding: chunk.embedding,
            chunk_type: chunk.chunk_type,
            category: 'General',
            source_type: 'shared_pool',
            pool_document_id: documentId,
            chunking_metadata: {
              visual_grounding: chunk.visual_grounding,
              extraction_method: 'landing_ai',
            },
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
    
    const fullText = chunks.map(c => c.text).join('\n\n');
    
    try {
      const { error: processError } = await supabase.functions.invoke('process-document', {
        body: {
          documentId,
          fullText,
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
    if (agentId) {
      console.log(`Auto-assigned to agent: ${agentId}`);
    } else {
      console.log(`Added to SHARED POOL (no agent assignment)`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        chunksProcessed: processedChunks,
        message: agentId 
          ? `PDF uploaded to pool and assigned to agent`
          : `PDF uploaded to shared pool`,
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
