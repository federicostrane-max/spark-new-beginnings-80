import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { extractJsonWithLayoutAndCallback, pollJobUntilComplete, getJsonResult, type LlamaParseJsonResult } from "../_shared/llamaParseClient.ts";
import { reconstructFromLlamaParse } from "../_shared/documentReconstructor.ts";
import { parseMarkdownElements, type ParsedNode } from "../_shared/markdownElementParser.ts";
import { detectOCRIssues, enhanceWithVisionAPI, enhanceWithClaudePDF, buildEnhancedSuperDocument } from "../_shared/visionEnhancer.ts";
import { createTraceReport, finalizeTraceReport, type ProcessingTraceReport } from "../_shared/processingTraceReport.ts";

// Declare EdgeRuntime for background task support
declare const EdgeRuntime: any;

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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Pipeline A-Hybrid Process] Starting chunk processing');

    // Fetch documents to process (new OR stuck-resumable)
    let documents: any[] = [];
    
    if (documentId) {
      // Event-driven mode: fetch specific document
      const { data: singleDoc, error: fetchError } = await supabase
        .from('pipeline_a_hybrid_documents')
        .select('*')
        .eq('id', documentId)
        .single();
      
      if (fetchError) throw new Error(`Failed to fetch document: ${fetchError.message}`);
      if (singleDoc) documents = [singleDoc];
    } else {
      // Batch mode: fetch new documents AND stuck documents to resume
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      
      // 1. New documents (ingested status)
      const { data: newDocs } = await supabase
        .from('pipeline_a_hybrid_documents')
        .select('*')
        .eq('status', 'ingested')
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);
      
      if (newDocs) documents.push(...newDocs);
      
      // 2. Stuck documents to resume (processing with job_id, not recently updated)
      if (documents.length < BATCH_SIZE) {
        const { data: stuckDocs } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('*')
          .eq('status', 'processing')
          .not('llamaparse_job_id', 'is', null)
          .lt('updated_at', twoMinutesAgo)
          .order('updated_at', { ascending: true })
          .limit(BATCH_SIZE - documents.length);
        
        if (stuckDocs) {
          console.log(`[Pipeline A-Hybrid Process] 🔄 Found ${stuckDocs.length} stuck document(s) to resume`);
          documents.push(...stuckDocs);
        }
      }
      
      // 3. Zombie documents (processing but never got job_id, stuck > 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      if (documents.length < BATCH_SIZE) {
        const { data: zombieDocs } = await supabase
          .from('pipeline_a_hybrid_documents')
          .select('*')
          .eq('status', 'processing')
          .is('llamaparse_job_id', null)
          .lt('updated_at', fiveMinutesAgo)
          .order('updated_at', { ascending: true })
          .limit(BATCH_SIZE - documents.length);
        
        if (zombieDocs && zombieDocs.length > 0) {
          console.log(`[Pipeline A-Hybrid Process] 🧟 Found ${zombieDocs.length} zombie document(s) - timeout before job_id`);
          documents.push(...zombieDocs);
        }
      }
    }

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

        // ===== PHASE 0: CONTEXT ANALYZER (COMMON TO ALL SOURCE TYPES) =====
        console.log('[Context Analyzer] Starting document context analysis...');
        const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
        
        let documentContext: any = {
          domain: 'general',
          focusElements: [],
          terminology: [],
          verbosity: 'conceptual'
        };

        // Extract text sample for context analysis
        let textSample = '';
        if (doc.source_type === 'markdown') {
          const markdownText = await fileData.text();
          textSample = markdownText.substring(0, 2000);
        } else if (doc.source_type === 'pdf') {
          // PDF: analyze after reconstruction (done later in PDF block)
          textSample = ''; // Will be set later
        } else if (doc.source_type === 'image') {
          textSample = ''; // Images have no text for context
        }

        if (anthropicKey && textSample.length > 100) {
          try {
            const { analyzeDocumentContext } = await import("../_shared/contextAnalyzer.ts");
            documentContext = await analyzeDocumentContext(textSample, anthropicKey, doc.file_name);
            
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
        } else if (doc.source_type !== 'pdf') {
          console.log('[Context Analyzer] Skipped (no Anthropic key or insufficient text)');
          traceReport.context_analysis.skipped_reason = 'No Anthropic key or insufficient text';
        }

        // ===== FORK BASED ON SOURCE_TYPE =====
        let superDocumentToChunk: string;
        let chunks: any[];
        let metadata: any = {};

        if (doc.source_type === 'markdown') {
          // MARKDOWN PATH: Context-aware with embedded image enrichment
          console.log(`[Pipeline A-Hybrid Process] Processing Markdown file: ${doc.file_name}`);
          let markdownContent = await fileData.text();
          
          // Helper: detect embedded images
          function detectEmbeddedImages(markdown: string): Array<{alt: string; url: string; position: number}> {
            const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
            const images: Array<{alt: string; url: string; position: number}> = [];
            let match;
            while ((match = imageRegex.exec(markdown)) !== null) {
              images.push({ alt: match[1], url: match[2], position: match.index });
            }
            return images;
          }
          
          const embeddedImages = detectEmbeddedImages(markdownContent);
          console.log(`[Markdown Visual Enrichment] Found ${embeddedImages.length} embedded image(s)`);
          
          if (embeddedImages.length > 0 && anthropicKey) {
            traceReport.visual_enrichment.elements_found = embeddedImages.length;
            
            const { describeVisualElementContextAware } = await import("../_shared/visionEnhancer.ts");
            
            for (const img of embeddedImages) {
              try {
                console.log(`[Markdown Visual Enrichment] Fetching and describing: ${img.url}`);
                
                // Fetch image from URL
                const imageResponse = await fetch(img.url);
                if (!imageResponse.ok) {
                  console.warn(`[Markdown Visual Enrichment] Failed to fetch ${img.url}: ${imageResponse.status}`);
                  traceReport.visual_enrichment.elements_failed++;
                  continue;
                }
                
                const imageBuffer = new Uint8Array(await imageResponse.arrayBuffer());
                
                // Context-aware description (no page number for embedded markdown images)
                const description = await describeVisualElementContextAware(
                  imageBuffer,
                  'embedded_image',
                  documentContext,
                  anthropicKey,
                  undefined  // Page number not available for embedded markdown images
                );
                
                // Replace image reference with description
                const imageMarkdown = `![${img.alt}](${img.url})`;
                const enrichedMarkdown = `\n\n**${img.alt || 'Figure'}:**\n${description}\n\n`;
                markdownContent = markdownContent.replace(imageMarkdown, enrichedMarkdown);
                
                traceReport.visual_enrichment.elements_processed++;
                traceReport.visual_enrichment.details.push({
                  name: img.url,
                  type: 'embedded_image',
                  page: 0,
                  chars_generated: description.length,
                  prompt_domain: documentContext.domain,
                  success: true
                });
                
                console.log(`[Markdown Visual Enrichment] ✓ Enriched ${img.url} (${description.length} chars)`);
              } catch (err) {
                console.warn(`[Markdown Visual Enrichment] Failed to process ${img.url}:`, err);
                traceReport.visual_enrichment.elements_failed++;
                traceReport.visual_enrichment.details.push({
                  name: img.url,
                  type: 'embedded_image',
                  page: 0,
                  chars_generated: 0,
                  prompt_domain: documentContext.domain,
                  success: false,
                  error: String(err)
                });
              }
            }
          }
          
          console.log('[Pipeline A-Hybrid Process] Parsing enriched Markdown elements');
          const parseResult = await parseMarkdownElements(markdownContent, lovableApiKey);
          chunks = parseResult.baseNodes;
          
          metadata = {
            source_type: 'markdown',
            chunks_generated: chunks.length,
            processing_method: embeddedImages.length > 0 ? 'markdown_with_visual_enrichment' : 'direct_markdown_parse',
            embedded_images_found: embeddedImages.length,
            embedded_images_enriched: traceReport.visual_enrichment.elements_processed
          };
          
          console.log(`[Pipeline A-Hybrid Process] Generated ${chunks.length} chunks from Markdown (${embeddedImages.length} images enriched)`);
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
          const parseResult = await parseMarkdownElements(imageDescription, lovableApiKey);
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

          // ===== LOGICA RESUME POLLING + PERSISTENZA IMMEDIATA =====
          console.log(`[Pipeline A-Hybrid Process] Starting LlamaParse for ${doc.file_name}, size: ${pdfBuffer.length} bytes`);
          const llamaStartTime = Date.now();

          let jsonResult: LlamaParseJsonResult;

          if (doc.llamaparse_job_id) {
            // RESUME MODE: Il documento ha già un Job ID (probabile timeout precedente)
            console.log(`[Pipeline A-Hybrid Process] 🔄 RESUMING existing LlamaParse job: ${doc.llamaparse_job_id}`);

            try {
              // Tentiamo di riprendere il polling sul job esistente
              const jobStatus = await pollJobUntilComplete(doc.llamaparse_job_id, llamaCloudKey);

              let rawJson: any;
              if (jobStatus.result) {
                rawJson = jobStatus.result;
              } else {
                rawJson = await getJsonResult(doc.llamaparse_job_id, llamaCloudKey);
              }

              jsonResult = {
                jobId: doc.llamaparse_job_id,
                rawJson,
                status: 'SUCCESS'
              };
              console.log(`[Pipeline A-Hybrid Process] ✅ Resume successful for job ${doc.llamaparse_job_id} in ${Date.now() - llamaStartTime}ms`);

            } catch (resumeError) {
              console.warn(`[Pipeline A-Hybrid Process] ⚠️ Resume failed for ${doc.llamaparse_job_id}, creating new job:`, resumeError);
              
              // Fallback: Se il vecchio job è scaduto/invalido, ne creiamo uno nuovo
              jsonResult = await extractJsonWithLayoutAndCallback(
                pdfBuffer, 
                doc.file_name, 
                llamaCloudKey,
                async (jobId: string) => {
                  console.log(`[Pipeline A-Hybrid Process] 💾 Persisting NEW llamaparse_job_id (fallback): ${jobId}`);
                  await supabase
                    .from('pipeline_a_hybrid_documents')
                    .update({ llamaparse_job_id: jobId })
                    .eq('id', doc.id);
                }
              );
            }
          } else {
            // NEW MODE: Primo tentativo - crea nuovo job con persistenza immediata
            jsonResult = await extractJsonWithLayoutAndCallback(
              pdfBuffer, 
              doc.file_name, 
              llamaCloudKey,
              async (jobId: string) => {
                console.log(`[Pipeline A-Hybrid Process] 💾 Persisting NEW llamaparse_job_id: ${jobId}`);
                await supabase
                  .from('pipeline_a_hybrid_documents')
                  .update({ llamaparse_job_id: jobId })
                  .eq('id', doc.id);
              }
            );
          }

          console.log(`[Pipeline A-Hybrid Process] LlamaParse completed in ${Date.now() - llamaStartTime}ms, jobId: ${jsonResult.jobId}`);
          console.log(`[Pipeline A-Hybrid Process] Raw JSON has ${jsonResult.rawJson?.items?.length || 0} items, ${jsonResult.rawJson?.layout?.length || 0} layout elements`);

          // Reconstruct document using hierarchical algorithm
          console.log('[Pipeline A-Hybrid Process] Reconstructing document with hierarchical reading order');
          const { superDocument, orderedElements, headingMap } = reconstructFromLlamaParse(jsonResult.rawJson);
          let mutableSuperDocument = superDocument; // Make mutable for placeholder insertion
          console.log(`[Pipeline A-Hybrid Process] Reconstruction completed: ${orderedElements.length} elements ordered, ${headingMap?.size || 0} headings mapped`);
          console.log(`[Pipeline A-Hybrid Process] Super-document length: ${superDocument.length} characters`);

          // ===== FASE 1: CONTEXT ANALYZER for PDF (reuse or analyze if not done) =====
          if (!documentContext.domain || documentContext.domain === 'general') {
            console.log('[Context Analyzer] Analyzing PDF context...');
            
            if (anthropicKey && superDocument.length > 100) {
              try {
                const textSample = superDocument.substring(0, 2000);
                const { analyzeDocumentContext } = await import("../_shared/contextAnalyzer.ts");
                documentContext = await analyzeDocumentContext(textSample, anthropicKey, doc.file_name);
                
                traceReport.context_analysis = {
                  domain: documentContext.domain,
                  focus_elements: documentContext.focusElements || [],
                  terminology: documentContext.terminology || [],
                  verbosity: documentContext.verbosity,
                  analysis_model: 'claude-3-5-haiku-20241022'
                };
                
                console.log(`[Context Analyzer] ✓ Domain: ${documentContext.domain}`);
                console.log(`[Context Analyzer] ✓ Focus: ${documentContext.focusElements?.join(', ') || 'general'}`);
              } catch (err) {
                console.warn('[Context Analyzer] Failed, using general context:', err);
                traceReport.context_analysis.skipped_reason = `Analysis failed: ${err}`;
              }
            }
          }

          // ===== FASE 2 & 3: ASYNC VISUAL ENRICHMENT QUEUE =====
          const VISUAL_ELEMENT_TYPES = ['layout_picture', 'layout_table', 'layout_keyValueRegion'];
          const queuedImagePlaceholders: Array<{ imageName: string; queueId: string; page: number }> = [];
          const MAX_IMAGES_PER_DOCUMENT = 50; // 🛡️ ARCHITECTURAL FIX: Limit to prevent memory overflow

          if (anthropicKey && jsonResult.rawJson?.pages) {
            console.log('[Visual Enrichment Queue] Scanning for visual elements to enqueue...');
            
            const { downloadJobImage } = await import("../_shared/llamaParseClient.ts");
            
            // 🚀 STEP 1: Collect and enqueue all images asynchronously (MAX 50)
            let enqueuedCount = 0;
            
            for (const page of jsonResult.rawJson.pages) {
              if (!page.images || page.images.length === 0) continue;
              
              for (const image of page.images) {
                // 🛡️ STOP if we hit the limit
                if (enqueuedCount >= MAX_IMAGES_PER_DOCUMENT) {
                  console.log(`[Visual Queue] ⚠️ LIMIT REACHED: Stopped at ${MAX_IMAGES_PER_DOCUMENT} images to prevent timeout`);
                  break;
                }
                
                if (VISUAL_ELEMENT_TYPES.includes(image.type)) {
                  traceReport.visual_enrichment.elements_found++;
                  
                  try {
                    // Download image from LlamaParse
                    const imageBuffer = await downloadJobImage(jsonResult.jobId, image.name, llamaCloudKey);
                    const imageSizeMB = imageBuffer.length / (1024 * 1024);
                    
                    // Skip if image too large
                    if (imageSizeMB > 5) {
                      console.log(`[Visual Queue] ⚠️ SKIPPED ${image.name} - Size ${imageSizeMB.toFixed(2)}MB exceeds 5MB`);
                      traceReport.visual_enrichment.elements_failed++;
                      continue;
                    }
                    
                    // Encode image to base64
                    const base64Image = encodeBase64(imageBuffer);
                    
                    // Insert into visual_enrichment_queue
                    const { data: queueEntry, error: queueError } = await supabase
                      .from('visual_enrichment_queue')
                      .insert({
                        document_id: doc.id,
                        image_base64: base64Image,
                        image_metadata: {
                          image_name: image.name,
                          type: image.type,
                          page: page.page,
                          llamaparse_job_id: jsonResult.jobId,
                          document_context: documentContext
                        },
                        status: 'pending'
                      })
                      .select('id')
                      .single();
                    
                    if (queueError) {
                      console.error(`[Visual Queue] Failed to enqueue ${image.name}:`, queueError);
                      traceReport.visual_enrichment.elements_failed++;
                      continue;
                    }
                    
                    // Store queue ID for placeholder insertion
                    queuedImagePlaceholders.push({
                      imageName: image.name,
                      queueId: queueEntry.id,
                      page: page.page
                    });
                    
                    enqueuedCount++; // 🛡️ INCREMENT COUNTER
                    console.log(`[Visual Queue] ✓ Enqueued ${image.name} (queue_id: ${queueEntry.id}) [${enqueuedCount}/${MAX_IMAGES_PER_DOCUMENT}]`);
                    
                    // 🚀 EVENT-DRIVEN: Invoke worker immediately for this image
                    try {
                      EdgeRuntime.waitUntil(
                        supabase.functions.invoke('process-vision-job', {
                          body: { queueItemId: queueEntry.id }
                        })
                      );
                      console.log(`[Visual Queue] → Worker invoked for queue_id: ${queueEntry.id}`);
                    } catch (invokeError) {
                      console.warn(`[Visual Queue] Failed to invoke worker for ${queueEntry.id}:`, invokeError);
                      // Not critical - cron fallback will catch it
                    }
                    
                  } catch (error: any) {
                    console.error(`[Visual Queue] Error enqueueing ${image.name}:`, error);
                    traceReport.visual_enrichment.elements_failed++;
                  }
                }
              }
              
              // 🛡️ BREAK outer loop if limit reached
              if (enqueuedCount >= MAX_IMAGES_PER_DOCUMENT) break;
            }
            
            console.log(`[Visual Enrichment Queue] ✅ Enqueued ${queuedImagePlaceholders.length} images for async processing`);
            
            // Insert placeholders into superDocument for each enqueued image
            for (const placeholder of queuedImagePlaceholders) {
              const placeholderText = `\n\n[VISUAL_ENRICHMENT_PENDING: ${placeholder.queueId}]\n(Image: ${placeholder.imageName}, Page: ${placeholder.page})\n\n`;
              mutableSuperDocument += placeholderText;
            }
            
            console.log(`[Visual Queue] Inserted ${queuedImagePlaceholders.length} placeholders into document`);
          } else {
            console.log('[Visual Enrichment Queue] Skipped (no Anthropic key or no images)');
          }

          // TODO: Integrate visualDescriptions into Super-Document
          // For now, continue with existing Vision Enhancement Layer for OCR issues
          
          // ===== VISION ENHANCEMENT LAYER (OCR Issues) =====
          let visionEnhancementUsed = false;
          let visionEngine: 'claude' | 'google' | null = null;
          let issuesDetected: any[] = [];
          superDocumentToChunk = mutableSuperDocument; // Initialize before OCR processing

           // 🛡️ MEMORY SAFEGUARD: Skip OCR correction if Visual Enrichment Queue has items
           const skipOCRProcessing = queuedImagePlaceholders.length > 0;
           if (skipOCRProcessing) {
             console.log(`[Vision Enhancement] OCR correction skipped - Visual Enrichment Queue has ${queuedImagePlaceholders.length} pending items`);
             traceReport.ocr_corrections.issues_detected = 0;
             traceReport.ocr_corrections.corrections_applied = 0;
           } else {
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
         } // Close skipVisualEnrichment else branch
         
         // 🧹 MEMORY: pdfBuffer no longer needed after Vision Enhancement - eligible for GC

          // Parse reconstructed document into chunks (using enhanced doc if Vision was used)
          console.log('[Pipeline A-Hybrid Process] Chunking reconstructed document');
          const parseResult = await parseMarkdownElements(superDocumentToChunk, lovableApiKey);
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

        // ✅ ARCHITECTURAL FIX: Populate chunk_id in visual_enrichment_queue jobs
        // Jobs were created with chunk_id NULL (before chunks existed)
        // Now match placeholder queue_ids with actual chunk_ids
        console.log('[Chunk-Job Linking] Matching placeholders with queue jobs...');
        
        const { data: createdChunks, error: fetchError } = await supabase
          .from('pipeline_a_hybrid_chunks_raw')
          .select('id, content')
          .eq('document_id', doc.id)
          .like('content', '%[VISUAL_ENRICHMENT_PENDING:%');
        
        if (fetchError) {
          console.error('[Chunk-Job Linking] Failed to fetch chunks with placeholders:', fetchError);
        } else if (createdChunks && createdChunks.length > 0) {
          let linkedCount = 0;
          
          for (const chunk of createdChunks) {
            // Extract queue_id from placeholder: [VISUAL_ENRICHMENT_PENDING: queue_id]
            const match = chunk.content.match(/\[VISUAL_ENRICHMENT_PENDING:\s*([a-f0-9-]+)\]/);
            if (match && match[1]) {
              const queueId = match[1];
              
              // Update job with chunk_id
              const { error: updateError } = await supabase
                .from('visual_enrichment_queue')
                .update({ chunk_id: chunk.id })
                .eq('id', queueId)
                .eq('document_id', doc.id);
              
              if (updateError) {
                console.error(`[Chunk-Job Linking] Failed to link chunk ${chunk.id} to job ${queueId}:`, updateError);
              } else {
                linkedCount++;
              }
            }
          }
          
          console.log(`[Chunk-Job Linking] ✅ Linked ${linkedCount}/${createdChunks.length} chunks to their visual jobs`);
        } else {
          console.log('[Chunk-Job Linking] No placeholder chunks found');
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
          embedding_status: 'ready'  // Mark as ready to bypass embedding (chunk_index=-1 filtered)
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
