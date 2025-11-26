import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReprocessResult {
  documentId: string;
  fileName: string;
  status: 'success' | 'failed';
  chunksCreated?: number;
  error?: string;
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

    startIndex += (chunkSize - overlap);
  }

  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openAIKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { batchSize = 5 } = await req.json();

    console.log('[reprocess] Starting document reprocessing...');

    // ========================================
    // STEP 1: Find documents without chunks
    // ========================================
    const { data: documents, error: docsError } = await supabase
      .from('knowledge_documents')
      .select('id, file_name, file_path, full_text')
      .eq('processing_status', 'ready_for_assignment')
      .limit(batchSize);

    if (docsError) throw docsError;

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No documents to reprocess',
          results: []
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[reprocess] Found ${documents.length} documents to check`);

    // Filter documents that actually have 0 chunks
    const documentsToProcess = [];
    for (const doc of documents) {
      const { count } = await supabase
        .from('agent_knowledge')
        .select('id', { count: 'exact', head: true })
        .eq('pool_document_id', doc.id);

      if (count === 0) {
        documentsToProcess.push(doc);
      }
    }

    console.log(`[reprocess] ${documentsToProcess.length} documents need chunk creation`);

    const results: ReprocessResult[] = [];

    // ========================================
    // STEP 2: Process each document
    // ========================================
    for (const doc of documentsToProcess) {
      try {
        console.log(`[reprocess] Processing ${doc.file_name}...`);

        let extractedText = doc.full_text;

        // If no full_text, extract from PDF
        if (!extractedText || extractedText.trim().length === 0) {
          console.log(`[reprocess] Extracting text for ${doc.file_name}...`);
          
          const { data: extractData, error: extractError } = await supabase.functions.invoke(
            'extract-pdf-text',
            {
              body: { filePath: doc.file_path }
            }
          );

          if (extractError) throw new Error(`Text extraction failed: ${extractError.message}`);
          
          if (!extractData || !extractData.text) {
            throw new Error('Could not extract text from PDF');
          }

          extractedText = extractData.text;

          // Update full_text in knowledge_documents
          await supabase
            .from('knowledge_documents')
            .update({ 
              full_text: extractedText,
              text_length: extractedText.length
            })
            .eq('id', doc.id);
        }

        // ========================================
        // STEP 3: Chunk the text
        // ========================================
        console.log(`[reprocess] Chunking text for ${doc.file_name}...`);
        const textChunks = chunkText(extractedText);
        
        if (textChunks.length === 0) {
          throw new Error('No chunks created from text');
        }

        console.log(`[reprocess] Created ${textChunks.length} chunks for ${doc.file_name}`);

        // ========================================
        // STEP 4: Generate embeddings and insert chunks
        // ========================================
        let insertedChunks = 0;
        
        for (let i = 0; i < textChunks.length; i++) {
          const chunk = textChunks[i];
          
          try {
            // Generate embedding
            const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openAIKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: chunk,
              }),
            });

            if (!embeddingResponse.ok) {
              throw new Error(`OpenAI API error: ${embeddingResponse.statusText}`);
            }

            const embeddingData = await embeddingResponse.json();
            const embedding = embeddingData.data[0].embedding;

            // Insert chunk into shared pool
            const { error: insertError } = await supabase
              .from('agent_knowledge')
              .insert({
                agent_id: null, // Shared pool
                pool_document_id: doc.id,
                document_name: doc.file_name,
                content: chunk,
                category: 'PDF Knowledge',
                summary: `Chunk ${i + 1} of ${textChunks.length}`,
                embedding: `[${embedding.join(',')}]`,
                source_type: 'shared_pool',
                chunking_metadata: {
                  chunk_index: i,
                  total_chunks: textChunks.length,
                  chunk_size: chunk.length,
                },
                is_active: true
              });

            if (insertError) {
              console.error(`[reprocess] Error inserting chunk ${i + 1}:`, insertError);
            } else {
              insertedChunks++;
            }
          } catch (chunkError: any) {
            console.error(`[reprocess] Error processing chunk ${i + 1}:`, chunkError.message);
            // Continue with next chunk
          }
        }

        console.log(`[reprocess] ✓ Successfully inserted ${insertedChunks}/${textChunks.length} chunks for ${doc.file_name}`);

        results.push({
          documentId: doc.id,
          fileName: doc.file_name,
          status: insertedChunks > 0 ? 'success' : 'failed',
          chunksCreated: insertedChunks,
          error: insertedChunks === 0 ? 'No chunks could be inserted' : undefined
        });

      } catch (docError: any) {
        console.error(`[reprocess] Failed to process ${doc.file_name}:`, docError.message);
        
        // Mark as validation_failed if extraction failed
        if (docError.message.includes('extract') || docError.message.includes('PDF')) {
          await supabase
            .from('knowledge_documents')
            .update({ 
              processing_status: 'validation_failed',
              validation_status: 'invalid',
              validation_reason: `Reprocess failed: ${docError.message}`
            })
            .eq('id', doc.id);
        }

        results.push({
          documentId: doc.id,
          fileName: doc.file_name,
          status: 'failed',
          error: docError.message
        });
      }
    }

    // ========================================
    // STEP 5: Return summary
    // ========================================
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    const totalChunks = results.reduce((sum, r) => sum + (r.chunksCreated || 0), 0);

    console.log(`[reprocess] Complete: ${successCount} success, ${failedCount} failed, ${totalChunks} total chunks created`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          processed: results.length,
          successful: successCount,
          failed: failedCount,
          totalChunks
        },
        results
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[reprocess] Fatal error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error during reprocessing'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
