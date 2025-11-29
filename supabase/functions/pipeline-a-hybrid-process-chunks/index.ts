import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractJsonWithLayout } from "../_shared/llamaParseClient.ts";
import { reconstructFromLlamaParse } from "../_shared/documentReconstructor.ts";
import { parseMarkdownElements, type ParsedNode } from "../_shared/markdownElementParser.ts";
import { detectOCRIssues, enhanceWithVisionAPI, enhanceWithClaudePDF, buildEnhancedSuperDocument } from "../_shared/visionEnhancer.ts";
import { createTraceReport, finalizeTraceReport, type ProcessingTraceReport } from "../_shared/processingTraceReport.ts";

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
      const startTime = Date.now();
      const traceReport = createTraceReport();
      
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
          traceReport.context_analysis.skipped_reason = 'Chunks already exist';
          await supabase
            .from('pipeline_a_hybrid_documents')
            .update({ 
              status: 'chunked', 
              updated_at: new Date().toISOString(),
              processing_metadata: { ...doc.processing_metadata, trace_report: finalizeTraceReport(traceReport, startTime) }
            })
            .eq('id', doc.id);
          continue;
        }

        // Update status to processing
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({ status: 'processing', updated_at: new Date().toISOString() })
          .eq('id', doc.id);

        // Download file from storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from(doc.storage_bucket)
          .download(doc.file_path);

        if (downloadError || !fileData) {
          throw new Error(`Failed to download file: ${downloadError?.message || 'No data'}`);
        }

        // ===== FORK BASED ON SOURCE_TYPE =====
        let superDocumentToChunk: string;
        let chunks: any[];
        let metadata: any = {};

        if (doc.source_type === 'markdown') {
          // MARKDOWN PATH: Skip LlamaParse, parse directly
          console.log(`[Pipeline A-Hybrid Process] Processing Markdown file: ${doc.file_name}`);
          const markdownContent = await fileData.text();
          
          console.log('[Pipeline A-Hybrid Process] Parsing Markdown elements directly');
          const parseResult = await parseMarkdownElements(markdownContent, doc.file_name);
          chunks = parseResult.baseNodes;
          
          metadata = {
            source_type: 'markdown',
            chunks_generated: chunks.length,
            processing_method: 'direct_markdown_parse'
          };
          
          // Update trace report
          traceReport.context_analysis.skipped_reason = 'Markdown source - no PDF context analysis needed';
          
          console.log(`[Pipeline A-Hybrid Process] Generated ${chunks.length} chunks from Markdown`);
        } else if (doc.source_type === 'image') {
          // IMAGE PATH: Claude Vision direct (bypass LlamaParse)
          console.log(`[Pipeline A-Hybrid Process] Processing image document: ${doc.file_name}`);
          const pdfBuffer = new Uint8Array(await fileData.arrayBuffer());
          
          const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
          if (!anthropicKey) {
            throw new Error('ANTHROPIC_API_KEY required for image processing');
          }
          
          // Import describeImageWithClaude
          const { describeImageWithClaude } = await import("../_shared/visionEnhancer.ts");
          
          console.log('[Pipeline A-Hybrid Process] Calling Claude Vision for chart description');
          const imageDescription = await describeImageWithClaude(pdfBuffer, anthropicKey, doc.file_name);
          console.log(`[Pipeline A-Hybrid Process] Claude returned ${imageDescription.length} chars description`);
          
          // Generate chunks from description
          console.log('[Pipeline A-Hybrid Process] Parsing image description into chunks');
          const parseResult = await parseMarkdownElements(imageDescription, doc.file_name);
          chunks = parseResult.baseNodes;
          
          metadata = {
            source_type: 'image',
            processing_method: 'claude_vision_direct',
            description_length: imageDescription.length,
            chunks_generated: chunks.length
          };
          
          // Update trace report
          traceReport.context_analysis.skipped_reason = 'Image source - direct Claude Vision processing';
          traceReport.visual_enrichment.elements_found = 1;
          traceReport.visual_enrichment.elements_processed = 1;
          traceReport.visual_enrichment.details.push({
            name: doc.file_name,
            type: 'chart_image',
            page: 1,
            chars_generated: imageDescription.length,
            prompt_domain: 'general',
            success: true
          });
          
          console.log(`[Pipeline A-Hybrid Process] Generated ${chunks.length} chunks from image description`);
        } else {
          // PDF PATH: LlamaParse + Context-Aware Visual Enrichment
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

          // ===== FASE 1: CONTEXT ANALYZER (Director for PDF) =====
          console.log('[Context Analyzer] Starting document context analysis...');
          const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
          
          let documentContext: any = {
            domain: 'general',
            focusElements: [],
            terminology: [],
            verbosity: 'conceptual'
          };

          if (anthropicKey && superDocument.length > 100) {
            try {
              // Extract text sample for context analysis (first 2000 chars)
              const textSample = superDocument.substring(0, 2000);
              
              const { analyzeDocumentContext } = await import("../_shared/contextAnalyzer.ts");
              documentContext = await analyzeDocumentContext(textSample, anthropicKey);
              
              // Update trace report
              traceReport.context_analysis = {
                domain: documentContext.domain,
                focus_elements: documentContext.focusElements || [],
                terminology: documentContext.terminology || [],
                verbosity: documentContext.verbosity,
                analysis_model: 'claude-3-5-haiku-20241022'
              };
              
              console.log(`[Context Analyzer] ✓ Domain: ${documentContext.domain}`);
              console.log(`[Context Analyzer] ✓ Focus: ${documentContext.focusElements?.join(', ') || 'general'}`);
              console.log(`[Context Analyzer] ✓ Verbosity: ${documentContext.verbosity}`);
            } catch (err) {
              console.warn('[Context Analyzer] Failed, using general context:', err);
              traceReport.context_analysis.skipped_reason = `Analysis failed: ${err}`;
            }
          } else {
            console.log('[Context Analyzer] Skipped (no Anthropic key or insufficient text)');
            traceReport.context_analysis.skipped_reason = 'No Anthropic key or insufficient text';
          }

          // ===== FASE 2 & 3: CONTEXT-AWARE VISUAL ENRICHMENT =====
          const VISUAL_ELEMENT_TYPES = ['layout_picture', 'layout_table', 'layout_keyValueRegion'];
          const visualDescriptions = new Map<string, { type: string; description: string; page: number }>();

          if (anthropicKey && jsonResult.rawJson?.pages) {
            console.log('[Visual Enrichment] Scanning for visual elements...');
            
            const { downloadJobImage } = await import("../_shared/llamaParseClient.ts");
            const { describeVisualElementContextAware } = await import("../_shared/visionEnhancer.ts");
            
            for (const page of jsonResult.rawJson.pages) {
              if (!page.images || page.images.length === 0) continue;
              
              for (const image of page.images) {
                // Process only visual elements (not full-page screenshots)
                if (VISUAL_ELEMENT_TYPES.includes(image.type)) {
                  traceReport.visual_enrichment.elements_found++;
                  console.log(`[Visual Enrichment] Processing ${image.type}: ${image.name} with ${documentContext.domain} context`);
                  
                  try {
                    // 1. Download image from LlamaParse
                    const imageBuffer = await downloadJobImage(jsonResult.jobId, image.name, llamaCloudKey);
                    
                    // 2. Describe with context-awareness (Director-informed!)
                    const description = await describeVisualElementContextAware(
                      imageBuffer,
                      image.type,
                      documentContext,  // Context del Director!
                      anthropicKey
                    );
                    
                    // 3. Store description for Super-Document integration
                    visualDescriptions.set(image.name, {
                      type: image.type,
                      description,
                      page: page.page
                    });
                    
                    // Update trace report
                    traceReport.visual_enrichment.elements_processed++;
                    traceReport.visual_enrichment.details.push({
                      name: image.name,
                      type: image.type,
                      page: page.page,
                      chars_generated: description.length,
                      prompt_domain: documentContext.domain,
                      success: true
                    });
                    
                    console.log(`[Visual Enrichment] ✓ ${image.name}: ${description.length} chars (${documentContext.domain} focused)`);
                  } catch (err) {
                    console.warn(`[Visual Enrichment] Failed for ${image.name}:`, err);
                    traceReport.visual_enrichment.elements_failed++;
                    traceReport.visual_enrichment.details.push({
                      name: image.name,
                      type: image.type,
                      page: page.page,
                      chars_generated: 0,
                      prompt_domain: documentContext.domain,
                      success: false,
                      error: String(err)
                    });
                  }
                }
              }
            }
            
            console.log(`[Visual Enrichment] Completed: ${visualDescriptions.size} visual elements enriched`);
          } else {
            console.log('[Visual Enrichment] Skipped (no Anthropic key or no images)');
          }

          // TODO: Integrate visualDescriptions into Super-Document
          // For now, continue with existing Vision Enhancement Layer for OCR issues
          
          // ===== VISION ENHANCEMENT LAYER (OCR Issues) =====
          let visionEnhancementUsed = false;
          let visionEngine: 'claude' | 'google' | null = null;
          let issuesDetected: any[] = [];
          superDocumentToChunk = superDocument; // Preserva originale

          const ocrIssues = detectOCRIssues(superDocument);
          console.log(`[Vision Enhancement] Scanned for OCR issues: ${ocrIssues.length} found`);
          
          // Update trace report
          traceReport.ocr_corrections.issues_detected = ocrIssues.length;

          if (ocrIssues.length > 0) {
            console.log(`[Vision Enhancement] Issues detected:`, ocrIssues.map(i => `${i.type}: "${i.pattern}"`));
            issuesDetected = ocrIssues;
            
            // Add to trace report
            ocrIssues.forEach(issue => {
              traceReport.ocr_corrections.details.push({
                type: issue.type,
                pattern: issue.pattern,
                fixed: false  // Will be updated if correction succeeds
              });
            });

            // TRY CLAUDE PDF FIRST (native PDF support with contextual reasoning)
            const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
            
            if (anthropicKey) {
              try {
                console.log('[Vision Enhancement] Attempting Claude PDF native processing...');
                const claudeStartTime = Date.now();
                
                // Call Claude with native PDF support (no conversion needed!)
                const claudeText = await enhanceWithClaudePDF(pdfBuffer, anthropicKey, ocrIssues);
                
                if (claudeText && claudeText.length > 0) {
                  superDocumentToChunk = buildEnhancedSuperDocument(superDocument, claudeText, ocrIssues);
                  visionEnhancementUsed = true;
                  visionEngine = 'claude';
                  
                  // Update trace report
                  traceReport.ocr_corrections.corrections_applied = ocrIssues.length;
                  traceReport.ocr_corrections.engine_used = 'claude';
                  traceReport.ocr_corrections.details.forEach(d => d.fixed = true);
                  
                  console.log(`[Vision Enhancement] ✓ Claude PDF completed in ${Date.now() - claudeStartTime}ms, added ${claudeText.length} chars`);
                }
              } catch (claudeError) {
                console.warn('[Vision Enhancement] Claude PDF failed, falling back to Google:', claudeError);
              }
            } else {
              console.log('[Vision Enhancement] Claude not configured, trying Google Vision');
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
                    
                    // Update trace report
                    traceReport.ocr_corrections.corrections_applied = ocrIssues.length;
                    traceReport.ocr_corrections.engine_used = 'google';
                    traceReport.ocr_corrections.details.forEach(d => d.fixed = true);
                    
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
          chunks = parseResult.baseNodes;

          metadata = {
            llamaparse_job_id: jsonResult.jobId,
            chunks_generated: chunks.length,
            reconstruction_method: 'hierarchical_reading_order',
            vision_enhancement_used: visionEnhancementUsed,
            vision_engine: visionEngine,
            ocr_issues_detected: issuesDetected.length,
            ocr_issue_types: issuesDetected.map((i: any) => i.type)
          };

          console.log(`[Pipeline A-Hybrid Process] Generated ${chunks.length} chunks from reconstructed document`);
        }

        console.log(`[Pipeline A-Hybrid Process] Generated ${chunks.length} chunks from reconstructed document`);

        // Update chunking stats in trace report
        const chunkSizes = chunks.map((c: any) => c.content.length);
        traceReport.chunking_stats = {
          total_chunks: chunks.length,
          avg_chunk_size: Math.round(chunkSizes.reduce((sum, size) => sum + size, 0) / chunks.length),
          min_chunk_size: Math.min(...chunkSizes),
          max_chunk_size: Math.max(...chunkSizes),
          strategy: 'small-to-big',
          type_distribution: chunks.reduce((acc: Record<string, number>, c: any) => {
            const type = c.chunk_type || 'text';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
          }, {}),
          atomic_elements: chunks.filter((c: any) => c.is_atomic).length
        };

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

        // Finalize trace report
        const finalReport = finalizeTraceReport(traceReport, startTime);
        console.log(`[Trace Report] Processing completed in ${finalReport.duration_ms}ms`);
        
        // Create Meta-Chunk for Self-Awareness
        const metaChunk = {
          document_id: doc.id,
          chunk_index: -1,  // Special index for meta-chunk
          content: finalReport.summary_markdown,
          chunk_type: 'meta_report',
          is_atomic: true,
          embedding_status: 'skip'  // No embedding needed for meta-chunk
        };
        
        await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .insert(metaChunk);
        
        console.log(`[Trace Report] Meta-Chunk created for agent self-awareness`);

        // Update document status with trace report
        await supabase
          .from('pipeline_a_hybrid_documents')
          .update({
            status: 'chunked',
            llamaparse_job_id: metadata.llamaparse_job_id || null,
            page_count: null, // Not applicable for markdown
            processed_at: new Date().toISOString(),
            processing_metadata: {
              ...doc.processing_metadata,
              ...metadata,
              trace_report: finalReport
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
