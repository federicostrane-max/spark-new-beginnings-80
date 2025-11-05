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
      .eq('validation_status', 'validated')
      .maybeSingle();

    if (docError) throw docError;
    if (!poolDoc) {
      throw new Error(`Document ${documentId} not found or not validated`);
    }

    console.log(`[sync-pool-document] Found document: ${poolDoc.file_name}`);

    // ========================================
    // STEP 2: Check if already synced
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
    // STEP 3: Copy existing chunks from shared pool
    // ========================================
    console.log('[sync-pool-document] Looking for existing chunks in shared pool...');
    
    const { data: poolChunks, error: poolChunksError } = await supabase
      .from('agent_knowledge')
      .select('*')
      .eq('pool_document_id', documentId)
      .is('agent_id', null)
      .eq('source_type', 'shared_pool');

    if (poolChunksError) {
      console.error('[sync-pool-document] Error fetching pool chunks:', poolChunksError);
      throw poolChunksError;
    }

    if (poolChunks && poolChunks.length > 0) {
      console.log(`[sync-pool-document] Found ${poolChunks.length} existing chunks in shared pool`);
      console.log('[sync-pool-document] Copying chunks to agent...');

      // Copy chunks and assign to agent
      const chunksToInsert = poolChunks.map(chunk => ({
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

      return new Response(JSON.stringify({ 
        success: true,
        chunksCount: poolChunks.length,
        totalChunks: poolChunks.length,
        method: 'copied_from_pool'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[sync-pool-document] No existing chunks found, falling back to PDF processing...');

    // ========================================
    // STEP 4: FALLBACK - Download and extract text from PDF
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

    if (downloadError) {
      console.error('[sync-pool-document] Download error:', downloadError);
      throw new Error(`Failed to download PDF: ${downloadError.message}`);
    }

    if (!fileData) {
      throw new Error('No file data returned from storage');
    }

    // Use Lovable AI OCR to extract text
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const formData = new FormData();
    formData.append('file', fileData, poolDoc.file_name);

    console.log('[sync-pool-document] Extracting text with OCR...');
    
    const ocrResponse = await fetch(`${supabaseUrl}/functions/v1/ocr-image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: formData,
    });

    if (!ocrResponse.ok) {
      throw new Error(`OCR failed: ${ocrResponse.status}`);
    }

    const ocrData = await ocrResponse.json();
    const fullText = ocrData.text || '';

    if (!fullText || fullText.trim().length < 100) {
      throw new Error('Extracted text too short or empty');
    }

    console.log(`[sync-pool-document] Extracted ${fullText.length} characters`);

    // ========================================
    // STEP 5: Chunk the text
    // ========================================
    const chunks = chunkText(fullText, 1000, 200);
    console.log(`[sync-pool-document] Created ${chunks.length} chunks`);

    // ========================================
    // STEP 6: Generate embeddings and insert chunks
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
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Sync error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
