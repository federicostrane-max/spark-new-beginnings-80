import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractTextFromPDF } from "../_shared/pdfTextExtractor.ts";
import { SemanticBoundaryChunker } from "../_shared/contentAwareChunker.ts";
import { enrichChunkMetadata } from "../_shared/metadataEnricher.ts";
import { determineChunkType } from "../_shared/chunkClassifier.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 10; // Process max 10 documents per cron execution

/**
 * Sanitize text content to remove invalid Unicode sequences and control characters
 * that would cause PostgreSQL insertion errors
 */
function sanitizeContent(text: string): string {
  return text
    // Remove null bytes
    .replace(/\u0000/g, '')
    // Remove other control characters except newline, carriage return, and tab
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Remove invalid Unicode sequences (unpaired surrogates)
    .replace(/[\uD800-\uDFFF]/g, '')
    // Normalize Unicode to composed form (NFC)
    .normalize('NFC')
    // Trim excessive whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Pipeline C Process] Starting cron execution');

    // Fetch documents with status='ingested' (max BATCH_SIZE)
    const { data: documents, error: fetchError } = await supabase
      .from('pipeline_c_documents')
      .select('*')
      .eq('status', 'ingested')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error('[Pipeline C Process] Fetch error:', fetchError);
      return new Response(
        JSON.stringify({ error: `Failed to fetch documents: ${fetchError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!documents || documents.length === 0) {
      console.log('[Pipeline C Process] No documents to process');
      return new Response(
        JSON.stringify({ message: 'No documents to process', processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Pipeline C Process] Found ${documents.length} documents to process`);

    const results = {
      processed: 0,
      failed: 0,
      errors: [] as Array<{ documentId: string; error: string }>,
    };

    // Process each document
    for (const doc of documents) {
      try {
        console.log(`[Pipeline C Process] Processing document: ${doc.id} - ${doc.file_name}`);

        // Update status to 'processing'
        await supabase
          .from('pipeline_c_documents')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', doc.id);

        // Check if chunks already exist (prevent duplicates)
        const { data: existingChunks, error: checkError } = await supabase
          .from('pipeline_c_chunks_raw')
          .select('id')
          .eq('document_id', doc.id)
          .limit(1);

        if (checkError) {
          throw new Error(`Chunk check failed: ${checkError.message}`);
        }

        if (existingChunks && existingChunks.length > 0) {
          console.log(`[Pipeline C Process] Document ${doc.id} already has chunks, skipping`);
          
          // Update status to 'chunked'
          await supabase
            .from('pipeline_c_documents')
            .update({ status: 'chunked', processed_at: new Date().toISOString() })
            .eq('id', doc.id);
          
          results.processed++;
          continue;
        }

        // Download PDF from storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from(doc.storage_bucket)
          .download(doc.file_path);

        if (downloadError || !fileData) {
          throw new Error(`Storage download failed: ${downloadError?.message || 'No data'}`);
        }

        // Convert Blob to ArrayBuffer
        const arrayBuffer = await fileData.arrayBuffer();

        // Extract text from PDF with OCR fallback support
        console.log(`[Pipeline C Process] Extracting text from ${doc.file_name}`);
        const extractionResult = await extractTextFromPDF(arrayBuffer, {
          supabase,
          bucket: doc.storage_bucket,
          path: doc.file_path,
        });
        
        const textLength = extractionResult.fullText.length;
        console.log(`[Pipeline C Process] ✅ Extracted ${textLength} characters from ${doc.file_name} (${extractionResult.metadata.pageCount} pages)`);
        
        if (textLength === 0) {
          throw new Error('PDF text extraction returned 0 characters - file may be corrupted or image-only');
        }

        // Update page count
        await supabase
          .from('pipeline_c_documents')
          .update({ page_count: extractionResult.metadata.pageCount })
          .eq('id', doc.id);

        // Chunk text using SemanticBoundaryChunker
        console.log(`[Pipeline C Process] Chunking document with Content-Aware Chunker`);
        const chunker = new SemanticBoundaryChunker({
          maxChunkSize: 1500,
          minChunkSize: 200,
          overlapSize: 100,
          respectBoundaries: true,
          adaptiveSizing: true,
        });

        const semanticChunks = chunker.chunk(extractionResult.fullText);

        if (semanticChunks.length === 0) {
          throw new Error('Semantic chunker returned 0 chunks - document may be too short or text extraction failed');
        }

        console.log(`[Pipeline C Process] ✅ Created ${semanticChunks.length} semantic chunks`);

        // Prepare chunks for database insertion
        const chunksToInsert = semanticChunks.map((chunk, index) => {
          // Enrich metadata
          const enrichedMetadata = enrichChunkMetadata(
            {
              content: chunk.content,
              chunk_index: index,
              page_number: chunk.page_number,
            },
            extractionResult.fullText,
            semanticChunks.length
          );

          return {
            document_id: doc.id,
            chunk_index: index,
            content: sanitizeContent(chunk.content),
            chunk_type: enrichedMetadata.chunk_type,
            semantic_weight: enrichedMetadata.semantic_weight,
            position: enrichedMetadata.position,
            headings: enrichedMetadata.headings,
            keywords: enrichedMetadata.keywords,
            document_section: enrichedMetadata.document_section,
            page_number: chunk.page_number,
            visual_grounding: enrichedMetadata.visual_grounding,
            embedding_status: 'pending',
          };
        });

        // Insert chunks in batches of 50
        const CHUNK_BATCH_SIZE = 50;
        for (let i = 0; i < chunksToInsert.length; i += CHUNK_BATCH_SIZE) {
          const batch = chunksToInsert.slice(i, i + CHUNK_BATCH_SIZE);
          
          const { error: insertError } = await supabase
            .from('pipeline_c_chunks_raw')
            .insert(batch);

          if (insertError) {
            throw new Error(`Chunk insertion failed (batch ${i}): ${insertError.message}`);
          }
        }

        console.log(`[Pipeline C Process] ✅ Inserted ${chunksToInsert.length} chunks for document ${doc.id}`);

        // Update document status to 'chunked'
        await supabase
          .from('pipeline_c_documents')
          .update({ 
            status: 'chunked', 
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', doc.id);

        results.processed++;

      } catch (error) {
        console.error(`[Pipeline C Process] ❌ Error processing document ${doc.id}:`, error);
        
        // Update document status to 'failed'
        await supabase
          .from('pipeline_c_documents')
          .update({ 
            status: 'failed', 
            error_message: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString(),
          })
          .eq('id', doc.id);

        results.failed++;
        results.errors.push({
          documentId: doc.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    console.log(`[Pipeline C Process] ✅ Cron execution completed: ${results.processed} processed, ${results.failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.processed,
        failed: results.failed,
        errors: results.errors,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Pipeline C Process] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
