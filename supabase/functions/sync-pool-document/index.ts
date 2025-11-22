import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

  let documentId: string | undefined;
  let agentId: string | undefined;

  try {
    const body: SyncRequest = await req.json();
    documentId = body.documentId;
    agentId = body.agentId;

    console.log(`[sync-pool-document] Starting sync for document ${documentId} to agent ${agentId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ========================================
    // STEP 1: Get document from pool
    // ========================================
    const { data: poolDoc, error: docError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path, processing_status, validation_status, full_text')
      .eq('id', documentId)
      .eq('processing_status', 'ready_for_assignment')
      .maybeSingle();

    if (docError) throw docError;
    
    if (!poolDoc) {
      // Check if document exists but not ready
      const { data: anyDoc } = await supabase
        .from('knowledge_documents')
        .select('processing_status, validation_status, file_name')
        .eq('id', documentId)
        .maybeSingle();
      
      if (anyDoc) {
        return new Response(
          JSON.stringify({
            error: 'DOCUMENT_NOT_READY',
            message: `Document "${anyDoc.file_name}" is not ready for assignment.`,
            status: anyDoc.processing_status,
            validation: anyDoc.validation_status,
            documentId,
            agentId
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({
          error: 'DOCUMENT_NOT_FOUND',
          message: 'Document not found',
          documentId,
          agentId
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      
      // ✅ CRITICAL FIX: Mark as completed before returning
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
        message: 'Already synced',
        chunksCount: existingChunks.length 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // STEP 4: Copy ALL existing chunks for this document (including shared pool chunks with agent_id = NULL)
    // ========================================
    console.log('[sync-pool-document] Looking for existing chunks (any agent or shared pool)...');
    
    // First check if ANY chunks exist for this document (including shared pool AND other agents)
    const { data: sampleChunks, error: sampleError } = await supabase
      .from('agent_knowledge')
      .select('id')
      .eq('pool_document_id', documentId)
      .or('agent_id.is.null,agent_id.not.is.null') // Include both shared pool (null) and assigned chunks
      .limit(1);

    if (sampleError) {
      console.error('[sync-pool-document] Error checking for chunks:', sampleError);
      throw sampleError;
    }

    console.log(`[sync-pool-document] Sample chunks found: ${sampleChunks?.length || 0}`);

    if (sampleChunks && sampleChunks.length > 0) {
      // ✓ Shared pool chunks exist - NO COPYING needed!
      // Agent will access them via agent_document_links
      console.log(`[sync-pool-document] ✓ Found ${sampleChunks.length} chunks in shared pool. Agent can access them via agent_document_links.`);
      
      // Mark sync as completed - no copying needed!
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
        chunksCount: sampleChunks.length,
        totalChunks: sampleChunks.length,
        method: 'shared_pool_access'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // STEP 5: NO CHUNKS FOUND - Try to process the document now
    // ========================================
    console.log('[sync-pool-document] ❌ No existing chunks found for this document!');
    console.log(`[sync-pool-document] Document ID: ${documentId}`);
    console.log(`[sync-pool-document] File path in DB: ${poolDoc.file_path}`);
    
    // 🆕 CHECK IF DOCUMENT ALREADY HAS FULL_TEXT (e.g. GitHub Markdown imports)
    let fullText: string;
    
    if (poolDoc.full_text && poolDoc.full_text.trim().length > 0) {
      console.log(`[sync-pool-document] ✅ Using existing full_text from database (${poolDoc.full_text.length} characters)`);
      fullText = poolDoc.full_text;
    } else {
      // Try to extract text from the PDF
      console.log('[sync-pool-document] Attempting to extract text from storage...');
      
      try {
        const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-pdf-text', {
          body: { filePath: poolDoc.file_path }
        });

        if (extractError || !extractData?.text) {
          console.error('[sync-pool-document] Failed to extract text:', extractError);
          throw new Error('Could not extract text from PDF');
        }

        fullText = extractData.text;
        console.log(`[sync-pool-document] Extracted ${fullText.length} characters from PDF`);
      } catch (extractError) {
        console.error('[sync-pool-document] PDF extraction failed:', extractError);
      
        // Mark sync as failed
        await supabase
          .from('agent_document_links')
          .update({ 
            sync_status: 'failed',
            sync_completed_at: new Date().toISOString(),
            sync_error: 'Document has no chunks and could not be extracted. Needs re-upload.'
          })
          .eq('document_id', documentId)
          .eq('agent_id', agentId);
      
        return new Response(
          JSON.stringify({ 
            error: 'Document not processable',
            message: `The document "${poolDoc.file_name}" has no text chunks in the database and could not be extracted.\n\nSolution: Delete this document from the pool and re-upload it.`,
            documentId,
            agentId,
            fileName: poolDoc.file_name,
            suggestion: 'Delete and re-upload the document'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Create chunks from the extracted text
    console.log('[sync-pool-document] Creating chunks from extracted text...');
    const textChunks = chunkText(fullText, 1000, 200);
    console.log(`[sync-pool-document] Created ${textChunks.length} text chunks`);

    // Generate embeddings and insert chunks
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const chunksToInsert = [];
    const EMBEDDING_BATCH_SIZE = 10;

    for (let i = 0; i < textChunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = textChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      console.log(`[sync-pool-document] Processing embedding batch ${Math.floor(i / EMBEDDING_BATCH_SIZE) + 1}/${Math.ceil(textChunks.length / EMBEDDING_BATCH_SIZE)}`);

      for (const chunk of batch) {
        try {
          // Generate embedding
          const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'text-embedding-3-small',
              input: chunk,
            }),
          });

          if (!embeddingResponse.ok) {
            console.error('[sync-pool-document] Embedding API error:', await embeddingResponse.text());
            continue;
          }

          const embeddingData = await embeddingResponse.json();
          const embedding = embeddingData.data[0].embedding;

          chunksToInsert.push({
          agent_id: null, // ✅ SHARED POOL
            document_name: poolDoc.file_name,
            content: chunk,
            category: 'General',
            summary: `Part of ${poolDoc.file_name}`,
            embedding: JSON.stringify(embedding),
            source_type: 'shared_pool',
            pool_document_id: documentId,
          });

        } catch (embError) {
          console.error('[sync-pool-document] Error generating embedding:', embError);
        }
      }
    }

    console.log(`[sync-pool-document] Generated ${chunksToInsert.length} chunks with embeddings`);

    // Insert chunks in batches
    const INSERT_BATCH_SIZE = 50;
    let totalInserted = 0;
    
    for (let i = 0; i < chunksToInsert.length; i += INSERT_BATCH_SIZE) {
      const batch = chunksToInsert.slice(i, i + INSERT_BATCH_SIZE);
      console.log(`[sync-pool-document] Inserting batch ${Math.floor(i / INSERT_BATCH_SIZE) + 1}/${Math.ceil(chunksToInsert.length / INSERT_BATCH_SIZE)} (${batch.length} chunks)`);
      
      const { error: insertError } = await supabase
        .from('agent_knowledge')
        .insert(batch);

      if (insertError) {
        console.error('[sync-pool-document] Error inserting batch:', insertError);
        throw insertError;
      }
      
      totalInserted += batch.length;
    }

    console.log(`[sync-pool-document] ✓ Successfully created and inserted ${totalInserted} chunks`);

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
      method: 'processed_on_demand'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[sync-pool-document] Error:', error);
    
    // Mark sync as failed if we have the IDs
    if (documentId && agentId) {
      try {
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
      } catch (updateError) {
        console.error('[sync-pool-document] Failed to update sync_status to failed:', updateError);
      }
    }
    
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Sync error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
