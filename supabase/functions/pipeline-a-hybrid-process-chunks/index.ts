import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractJsonWithLayout } from "../_shared/llamaParseClient.ts";
import { reconstructFromLlamaParse } from "../_shared/documentReconstructor.ts";
import { parseMarkdownElements, type ParsedNode } from "../_shared/markdownElementParser.ts";
import { detectOCRIssues, enhanceWithVisionAPI, enhanceWithClaudeVision, convertPdfToImage, buildEnhancedSuperDocument } from "../_shared/visionEnhancer.ts";

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
        console.log(`[Pipeline A-Hybrid Process] Starting LlamaParse for ${doc.file_name}, size: ${pdfBuffer.length} bytes`);
        const startTime = Date.now();
        const jsonResult = await extractJsonWithLayout(pdfBuffer, doc.file_name, llamaCloudKey);
        console.log(`[Pipeline A-Hybrid Process] LlamaParse completed in ${Date.now() - startTime}ms, jobId: ${jsonResult.jobId}`);
        console.log(`[Pipeline A-Hybrid Process] Raw JSON has ${jsonResult.rawJson?.items?.length || 0} items, ${jsonResult.rawJson?.layout?.length || 0} layout elements`);

        // Reconstruct document using hierarchical algorithm
        console.log('[Pipeline A-Hybrid Process] Reconstructing document with hierarchical reading order');
        const { superDocument, orderedElements, headingMap } = reconstructFromLlamaParse(jsonResult.rawJson);
        console.log(`[Pipeline A-Hybrid Process] Reconstruction completed: ${orderedElements.length} elements ordered, ${headingMap?.size || 0} headings mapped`);
        console.log(`[Pipeline A-Hybrid Process] Super-document length: ${superDocument.length} characters`);

        // ===== VISION ENHANCEMENT LAYER =====
        let visionEnhancementUsed = false;
        let visionEngine: 'claude' | 'google' | null = null;
        let issuesDetected: any[] = [];
        let superDocumentToChunk = superDocument; // Preserva originale

        const ocrIssues = detectOCRIssues(superDocument);
        console.log(`[Vision Enhancement] Scanned for OCR issues: ${ocrIssues.length} found`);

        if (ocrIssues.length > 0) {
          console.log(`[Vision Enhancement] Issues detected:`, ocrIssues.map(i => `${i.type}: "${i.pattern}"`));
          issuesDetected = ocrIssues;

          // TRY CLAUDE VISION FIRST (contextual reasoning)
          const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
          const cloudmersiveKey = Deno.env.get('CLOUDMERSIVE_API_KEY');
          
          if (anthropicKey && cloudmersiveKey) {
            try {
              console.log('[Vision Enhancement] Attempting Claude Vision with Cloudmersive conversion...');
              const claudeStartTime = Date.now();
              
              // Convert PDF to PNG
              const imageBase64 = await convertPdfToImage(pdfBuffer, cloudmersiveKey);
              
              if (imageBase64) {
                // Call Claude with contextual prompt
                const claudeText = await enhanceWithClaudeVision(imageBase64, anthropicKey, ocrIssues);
                
                if (claudeText && claudeText.length > 0) {
                  superDocumentToChunk = buildEnhancedSuperDocument(superDocument, claudeText, ocrIssues);
                  visionEnhancementUsed = true;
                  visionEngine = 'claude';
                  console.log(`[Vision Enhancement] ✓ Claude Vision completed in ${Date.now() - claudeStartTime}ms, added ${claudeText.length} chars`);
                }
              }
            } catch (claudeError) {
              console.warn('[Vision Enhancement] Claude Vision failed, falling back to Google:', claudeError);
            }
          } else {
            console.log('[Vision Enhancement] Claude/Cloudmersive not configured, trying Google Vision');
          }

          // FALLBACK TO GOOGLE VISION if Claude didn't succeed
          if (!visionEnhancementUsed) {
            const googleVisionKey = Deno.env.get('GOOGLE_CLOUD_VISION_API_KEY');
            
            if (googleVisionKey) {
              try {
                console.log('[Vision Enhancement] Falling back to Google Cloud Vision...');
                const visionStartTime = Date.now();
                const visionText = await enhanceWithVisionAPI(pdfBuffer, googleVisionKey);
                console.log(`[Vision Enhancement] Google Vision completed in ${Date.now() - visionStartTime}ms`);

                if (visionText && visionText.length > 0) {
                  superDocumentToChunk = buildEnhancedSuperDocument(superDocument, visionText, ocrIssues);
                  visionEnhancementUsed = true;
                  visionEngine = 'google';
                  console.log(`[Vision Enhancement] ✓ Google Vision enhancement, added ${visionText.length} chars`);
                } else {
                  console.warn('[Vision Enhancement] Google Vision returned empty text');
                }
              } catch (visionError) {
                console.error('[Vision Enhancement] Google Vision also failed (graceful degradation):', visionError);
                // Continue with original document - no blocking
              }
            } else {
              console.warn('[Vision Enhancement] No vision API keys configured, using original document');
            }
          }
        } else {
          console.log('[Vision Enhancement] No OCR issues detected, using original document');
        }

        // Parse reconstructed document into chunks (using enhanced doc if Vision was used)
        console.log('[Pipeline A-Hybrid Process] Chunking reconstructed document');
        const parseResult = await parseMarkdownElements(superDocumentToChunk, doc.file_name);
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
              reconstruction_method: 'hierarchical_reading_order',
              vision_enhancement_used: visionEnhancementUsed,
              vision_engine: visionEngine, // 'claude' | 'google' | null
              ocr_issues_detected: issuesDetected.length,
              ocr_issue_types: issuesDetected.map((i: any) => i.type)
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
        const errorMessage = docError instanceof Error ? docError.message : 'Unknown error';
        const errorStack = docError instanceof Error ? docError.stack : undefined;
        console.error(`[Pipeline A-Hybrid Process] Error processing document ${doc.id}:`, {
          error: errorMessage,
          stack: errorStack,
          documentName: doc.file_name,
          documentId: doc.id
        });
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({
            status: 'failed',
            error_message: errorMessage,
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
