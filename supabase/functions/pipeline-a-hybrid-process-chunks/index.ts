import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractJsonWithLayout } from "../_shared/llamaParseClient.ts";
import { reconstructFromLlamaParse } from "../_shared/documentReconstructor.ts";
import { parseMarkdownElements, type ParsedNode } from "../_shared/markdownElementParser.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const llamaCloudKey = Deno.env.get('LLAMA_CLOUD_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Pipeline A-Hybrid Process] Starting chunk processing');

    // Fetch documents
    let query = supabase
      .from('pipeline_a_hybrid_documents')
      .select('*')
      .eq('status', 'ingested')
      .order('created_at', { ascending: true });

    if (documentId) {
      query = query.eq('id', documentId).limit(1);
    } else {
      query = query.limit(BATCH_SIZE);
    }

    const { data: documents, error: fetchError } = await query;

    if (fetchError) throw new Error(`Failed to fetch documents: ${fetchError.message}`);
    if (!documents || documents.length === 0) {
      console.log('[Pipeline A-Hybrid Process] No documents to process');
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No documents to process' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline A-Hybrid Process] Processing ${documents.length} document(s)`);

    let processedCount = 0;
    let failedCount = 0;

    for (const doc of documents) {
      try {
        console.log(`[Pipeline A-Hybrid Process] Processing document: ${doc.file_name}`);

        // Check for existing chunks
        const { data: existingChunks } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id')
          .eq('document_id', doc.id)
          .limit(1);

        if (existingChunks && existingChunks.length > 0) {
          console.log(`[Pipeline A-Hybrid Process] Document ${doc.id} already has chunks, skipping`);
          await supabase
            .from('pipeline_a_hybrid_documents')
            .update({ status: 'chunked', updated_at: new Date().toISOString() })
            .eq('id', doc.id);
          continue;
        }

        // Update status to processing
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', doc.id);

        // Download PDF from storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from(doc.storage_bucket)
          .download(doc.file_path);

        if (downloadError || !fileData) {
          throw new Error(`Failed to download file: ${downloadError?.message || 'No data'}`);
        }

        const pdfBuffer = new Uint8Array(await fileData.arrayBuffer());

        // Extract JSON with layout from LlamaParse
        console.log(`[Pipeline A-Hybrid Process] Calling LlamaParse for ${doc.file_name}`);
        const jsonResult = await extractJsonWithLayout(pdfBuffer, doc.file_name, llamaCloudKey);

        // Reconstruct document using hierarchical algorithm
        console.log('[Pipeline A-Hybrid Process] Reconstructing document with hierarchical reading order');
        const { superDocument, orderedElements, headingMap } = reconstructFromLlamaParse(jsonResult.rawJson);

        // Parse reconstructed document into chunks
        console.log('[Pipeline A-Hybrid Process] Chunking reconstructed document');
        const parseResult = await parseMarkdownElements(superDocument, doc.file_name);
        const chunks = parseResult.baseNodes;

        console.log(`[Pipeline A-Hybrid Process] Generated ${chunks.length} chunks from reconstructed document`);

        // Insert chunks in batches
        const chunkBatchSize = 50;
        for (let i = 0; i < chunks.length; i += chunkBatchSize) {
          const batch = chunks.slice(i, i + chunkBatchSize);
          const records = batch.map((chunk: ParsedNode, idx: number) => ({
            document_id: doc.id,
            chunk_index: i + idx,
            content: chunk.content,
            original_content: chunk.original_content || null,
            summary: chunk.summary || null,
            chunk_type: chunk.chunk_type || 'text',
            is_atomic: chunk.is_atomic || false,
            page_number: chunk.page_number || null,
            heading_hierarchy: chunk.heading_hierarchy || null,
            embedding_status: 'pending'
          }));

          const { error: insertError } = await supabase
            .from('pipeline_a_hybrid_chunks_raw')
            .insert(records);

          if (insertError) {
            throw new Error(`Failed to insert chunks: ${insertError.message}`);
          }
        }

        // Update document status
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({
            status: 'chunked',
            llamaparse_job_id: jsonResult.jobId,
            page_count: orderedElements.length > 0 ? Math.max(...orderedElements.map(e => e.page)) : null,
            processed_at: new Date().toISOString(),
            processing_metadata: {
              ...doc.processing_metadata,
              llamaparse_job_id: jsonResult.jobId,
              chunks_generated: chunks.length,
              reconstruction_method: 'hierarchical_reading_order'
            }
          })
          .eq('id', doc.id);

        console.log(`[Pipeline A-Hybrid Process] Document ${doc.id} processed successfully`);
        processedCount++;

        // Trigger embedding generation (event-driven)
        try {
          supabase.functions.invoke('pipeline-a-hybrid-generate-embeddings', {
            body: { documentId: doc.id }
          }).then(() => {
            console.log(`[Pipeline A-Hybrid Process] Triggered embeddings for ${doc.id}`);
          });
        } catch (invokeError) {
          console.warn('[Pipeline A-Hybrid Process] Failed to trigger embeddings (will be handled by cron):', invokeError);
        }

      } catch (docError) {
        console.error(`[Pipeline A-Hybrid Process] Error processing document ${doc.id}:`, docError);
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({
            status: 'failed',
            error_message: docError instanceof Error ? docError.message : 'Unknown error',
            updated_at: new Date().toISOString()
          })
          .eq('id', doc.id);
        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        failed: failedCount,
        message: `Processed ${processedCount} document(s), ${failedCount} failed`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline A-Hybrid Process] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
