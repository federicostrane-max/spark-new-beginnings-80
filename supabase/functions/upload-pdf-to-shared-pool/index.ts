import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sanitize text by removing NULL characters and other invalid characters
function sanitizeText(text: string): string {
  // Remove NULL bytes (\u0000) and other control characters that PostgreSQL can't handle
  return text
    .replace(/\u0000/g, '') // Remove NULL bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove other control characters
}

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

  // ⚠️ CRITICAL WORKFLOW NOTE:
  // This function uploads documents to the SHARED POOL.
  // It MUST NEVER create agent_document_links or assign documents to agents.
  // Documents remain in the shared pool and are assigned later by users through the UI.
  // NEVER use 'ai_assigned' - assignment is always done manually by users.

  try {
    let { text, fileName, fileSize, fileData } = await req.json();
    
    console.log('=== UPLOAD PDF TO SHARED POOL ===');
    console.log(`File: ${fileName}`);
    console.log(`Text length (raw): ${text?.length || 0} chars`);
    console.log(`File size: ${fileSize || 0} bytes`);

    if (!text || !fileName) {
      throw new Error('Missing required parameters: text or fileName');
    }

    // Sanitize text to remove NULL bytes and control characters
    text = sanitizeText(text);
    console.log(`Text length (sanitized): ${text.length} chars`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for duplicate filename
    console.log('[DUPLICATE CHECK] Verifying file does not exist...');
    const { data: existingDoc } = await supabase
      .from('knowledge_documents')
      .select('id, file_name')
      .eq('file_name', fileName)
      .maybeSingle();

    if (existingDoc) {
      console.error('[DUPLICATE CHECK] ✗ File already exists:', fileName);
      throw new Error(`Il documento "${fileName}" è già presente nel pool (ID: ${existingDoc.id})`);
    }
    console.log('[DUPLICATE CHECK] ✓ No duplicate found');

    // Step 0: Upload PDF file to storage if fileData is provided
    if (fileData) {
      console.log('[STEP 0] Uploading PDF to storage...');
      try {
        // Convert base64 to binary
        const binaryString = atob(fileData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const { error: uploadError } = await supabase.storage
          .from('shared-pool-uploads')
          .upload(fileName, bytes, {
            contentType: 'application/pdf',
            upsert: false
          });

        if (uploadError) {
          console.error('[STEP 0 ERROR]', uploadError);
          throw new Error(`Failed to upload PDF to storage: ${uploadError.message}`);
        }
        console.log('[STEP 0] ✓ PDF uploaded to storage successfully');
      } catch (storageError: any) {
        console.error('[STEP 0 ERROR]', storageError);
        throw new Error(`Failed to upload PDF: ${storageError?.message || 'Unknown error'}`);
      }
    } else {
      console.warn('[STEP 0] ⚠️ No fileData provided, PDF will not be stored (text chunks only)');
    }

    // Step 1: Create document in knowledge_documents
    console.log('[STEP 1] Creating document in knowledge_documents...');
    
    const { data: document, error: docError } = await supabase
      .from('knowledge_documents')
      .insert({
        file_name: fileName,
        file_path: `shared-pool-uploads/${fileName}`,
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

    // Step 2: Chunk the text
    console.log('[STEP 2] Chunking text...');
    const chunks = chunkText(text, 1000, 200);
    console.log(`[STEP 2] ✓ Created ${chunks.length} chunks`);

    // Step 3: Process chunks in batches (generate embeddings and insert)
    console.log('[STEP 3] Processing chunks with embeddings...');
    
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
            model: 'text-embedding-3-small',
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

      // Insert chunks into agent_knowledge with agent_id = NULL (shared pool)
      const { error: insertError } = await supabase
        .from('agent_knowledge')
        .insert(
          chunksWithEmbeddings.map((chunk) => ({
            agent_id: null,  // NULL = shared pool, not assigned yet
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

    console.log(`[STEP 3] ✓ All ${processedChunks} chunks processed and inserted`);

    // Step 4: Trigger AI analysis to generate summary
    console.log('[STEP 4] Triggering AI analysis for summary...');
    
    try {
      const { error: processError } = await supabase.functions.invoke('process-document', {
        body: {
          documentId,
          fullText: text,
        },
      });

      if (processError) {
        console.warn('[STEP 4 WARNING] AI analysis failed (non-critical):', processError);
      } else {
        console.log('[STEP 4] ✓ AI analysis triggered - summary will be generated');
      }
    } catch (analysisError) {
      console.warn('[STEP 4 WARNING] AI analysis failed (non-critical):', analysisError);
    }

    // Step 5: Update processing status
    console.log('[STEP 5] Updating document status...');
    
    const { error: updateError } = await supabase
      .from('knowledge_documents')
      .update({ processing_status: 'ready_for_assignment' })
      .eq('id', documentId);

    if (updateError) {
      console.error('[STEP 5 ERROR]', updateError);
      throw updateError;
    }

    console.log('[STEP 5] ✓ Document status updated to ready_for_assignment');

    console.log('=== UPLOAD COMPLETE ===');
    console.log(`Document ID: ${documentId}`);
    console.log(`Chunks processed: ${processedChunks}`);
    console.log('Document is now in shared pool, ready for assignment');

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        chunksProcessed: processedChunks,
        message: `PDF uploaded to shared pool`,
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