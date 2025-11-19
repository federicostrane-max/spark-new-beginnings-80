import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractMetadataWithFallback } from '../_shared/metadataExtractor.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chunk text into overlapping segments for embeddings
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

interface ProcessRequest {
  documentId: string;
  fullText?: string; // Complete extracted text (optional, can be fetched from DB)
  retryCount?: number; // Numero di retry già effettuati
}

interface AIAnalysis {
  summary: string;
  keywords: string[];
  topics: string[];
  complexity_level: 'basic' | 'intermediate' | 'advanced';
}

// Input validation helpers
function validateUUID(value: string, fieldName: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!value || !uuidRegex.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be a valid UUID`);
  }
}

function validateTextLength(text: string | undefined, fieldName: string, maxLength: number): void {
  if (text && text.length > maxLength) {
    throw new Error(`${fieldName} too long: maximum ${maxLength} characters allowed`);
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Set timeout for processing
  const timeoutId = setTimeout(() => {
    throw new Error('Processing timeout after 5 minutes');
  }, 5 * 60 * 1000);

  try {
    const { documentId, fullText: providedFullText, retryCount = 0 }: ProcessRequest = await req.json();
    
    // Validate inputs
    validateUUID(documentId, 'documentId');
    validateTextLength(providedFullText, 'fullText', 10000000); // 10MB max
    
    if (typeof retryCount !== 'number' || retryCount < 0 || retryCount > 5) {
      throw new Error('Invalid retryCount: must be a number between 0 and 5');
    }

    console.log(`[process-document] ========== START ==========`);
    console.log(`[process-document] Input:`, JSON.stringify({
      documentId,
      fullTextProvided: !!providedFullText,
      fullTextLength: providedFullText?.length || 0,
      retryCount
    }));
    console.log(`[process-document] Starting processing for document ${documentId} (retry: ${retryCount})`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get full text: check document.full_text first (for Markdown), then chunks, then extract PDF
    let fullText = providedFullText;
    if (!fullText) {
      console.log('[process-document] Full text not provided, checking document.full_text field...');
      
      // Check if document has pre-stored full_text (e.g., Markdown from GitHub)
      const { data: doc, error: docError } = await supabase
        .from('knowledge_documents')
        .select('full_text')
        .eq('id', documentId)
        .single();

      if (!docError && doc?.full_text && doc.full_text.trim() !== '') {
        console.log(`[process-document] Using pre-stored full_text (${doc.full_text.length} chars)`);
        fullText = doc.full_text;
      } else {
        // No full_text in document, try to reconstruct from chunks
        console.log('[process-document] No full_text found, checking for chunks...');
        
        const { data: chunks, error: chunksError } = await supabase
          .from('agent_knowledge')
          .select('content')
          .eq('pool_document_id', documentId)
          .order('created_at', { ascending: true });

        if (!chunksError && chunks && chunks.length > 0) {
          // Reconstruct full text from chunks
          fullText = chunks.map(c => c.content).join(' ');
          console.log(`[process-document] Reconstructed text from ${chunks.length} chunks (${fullText.length} chars)`);
        } else {
          // No chunks found, try to extract text from PDF
          console.log('[process-document] No chunks found, attempting PDF extraction...');
          
          try {
            const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-pdf-text', {
              body: { documentId }
            });

            if (extractError || !extractResult?.text) {
              console.warn(`[process-document] ⚠️ PDF extraction failed: ${extractError?.message || 'No text extracted'}`);
              
              // FALLBACK: Try one more time to get chunks (potrebbe essere stato creato nel frattempo)
              console.log('[process-document] FALLBACK: Attempting to reconstruct from chunks as last resort...');
              const { data: fallbackChunks } = await supabase
                .from('agent_knowledge')
                .select('content')
                .eq('pool_document_id', documentId)
                .is('agent_id', null)
                .order('created_at', { ascending: true });
              
              if (fallbackChunks && fallbackChunks.length > 0) {
                fullText = fallbackChunks.map(c => c.content).join(' ');
                console.log(`[process-document] ✓ FALLBACK SUCCESS: Reconstructed ${fullText.length} chars from ${fallbackChunks.length} chunks`);
              } else {
                throw new Error(`Cannot extract text from PDF and no chunks available for document ${documentId}`);
              }
            } else {
              const extractedText = extractResult.text;
              fullText = extractedText;
              console.log(`[process-document] ✓ Extracted ${extractedText.length} characters from PDF`);
              
              // Update the document with the extracted text length
              await supabase
                .from('knowledge_documents')
                .update({ text_length: extractedText.length })
                .eq('id', documentId);
            }
          } catch (pdfError: any) {
            console.error(`[process-document] PDF extraction error:`, pdfError);
            
            // FALLBACK: Last attempt to get chunks
            console.log('[process-document] FALLBACK: PDF extraction threw error, trying chunks...');
            const { data: errorFallbackChunks } = await supabase
              .from('agent_knowledge')
              .select('content')
              .eq('pool_document_id', documentId)
              .is('agent_id', null)
              .order('created_at', { ascending: true });
            
            if (errorFallbackChunks && errorFallbackChunks.length > 0) {
              fullText = errorFallbackChunks.map(c => c.content).join(' ');
              console.log(`[process-document] ✓ FALLBACK SUCCESS: Reconstructed ${fullText.length} chars from ${errorFallbackChunks.length} chunks after error`);
            } else {
              throw new Error(`PDF extraction failed and no chunks available: ${pdfError.message}`);
            }
          }
        }
      }
    }

    // Ensure we have text to process
    if (!fullText || fullText.trim().length === 0) {
      throw new Error('No text content available for processing');
    }

    // Update status to processing
    await supabase
      .from('knowledge_documents')
      .update({ processing_status: 'processing' })
      .eq('id', documentId);

    await supabase
      .from('document_processing_cache')
      .update({ processing_started_at: new Date().toISOString() })
      .eq('document_id', documentId);

    // ========================================
    // Check if AI Summary Already Exists (from Validation)
    // ========================================
    // With the new flow, AI summary is generated during validation
    // We only need to verify it exists and use it
    console.log('[process-document] Checking for existing AI summary from validation...');
    
    const { data: docData, error: docError } = await supabase
      .from('knowledge_documents')
      .select('ai_summary, keywords, topics, complexity_level')
      .eq('id', documentId)
      .single();

    if (docError) {
      throw new Error(`Failed to retrieve document metadata: ${docError.message}`);
    }

    let analysis: AIAnalysis;

    if (docData?.ai_summary && docData?.keywords && docData?.topics && docData?.complexity_level) {
      // AI summary already exists from validation phase - reuse it
      console.log('[process-document] ✅ Using AI summary from validation phase');
      analysis = {
        summary: docData.ai_summary,
        keywords: docData.keywords,
        topics: docData.topics,
        complexity_level: docData.complexity_level as 'basic' | 'intermediate' | 'advanced'
      };
    } else {
      // Fallback: generate AI summary if not present (shouldn't happen with new flow)
      console.log('[process-document] ⚠️ AI summary not found from validation, generating now (fallback)...');
      
      const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
      if (!lovableApiKey) {
        throw new Error('LOVABLE_API_KEY not configured');
      }

      const textSample = fullText.slice(0, 3000);
      const prompt = `Analizza questo estratto di documento PDF e genera metadati strutturati.

TESTO DEL DOCUMENTO:
"""
${textSample}
${fullText.length > 2000 ? '\n...(testo troncato)...' : ''}
"""

Genera un'analisi JSON con:
1. **summary**: Riassunto chiaro in 2-3 frasi di cosa tratta il documento (max 200 caratteri)
2. **keywords**: Array di 5-10 parole chiave principali (termini tecnici, concetti chiave)
3. **topics**: Array di 3-5 argomenti/temi trattati
4. **complexity_level**: Valuta il livello tecnico: "basic", "intermediate", o "advanced"

IMPORTANTE: Rispondi SOLO con JSON valido in questo formato:
{
  "summary": "Breve descrizione...",
  "keywords": ["keyword1", "keyword2", ...],
  "topics": ["topic1", "topic2", ...],
  "complexity_level": "basic|intermediate|advanced"
}`;

      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { 
              role: 'system', 
              content: 'Sei un esperto analista di documenti tecnici. Rispondi SOLO con JSON valido nel formato richiesto, senza testo aggiuntivo.' 
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.4,
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error('[process-document] AI API error:', aiResponse.status, errorText);
        
        // Retry logic per errori temporanei (429, 500, 503)
        if ([429, 500, 503].includes(aiResponse.status) && retryCount < 3) {
          const nextRetryCount = retryCount + 1;
          const delays = [2000, 5000, 10000]; // 2s, 5s, 10s
          const delay = delays[retryCount] || 10000;
          
          console.log(`[process-document] Retrying in ${delay}ms (attempt ${nextRetryCount}/3)...`);
          
          // Update retry count in cache
          await supabase
            .from('document_processing_cache')
            .update({ retry_count: nextRetryCount })
            .eq('document_id', documentId);
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, delay));
          
          // Recursive retry
          const retryResponse = await fetch(`${supabaseUrl}/functions/v1/process-document`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              documentId,
              fullText: fullText,
              retryCount: nextRetryCount
            }),
          });
          
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            console.log('[process-document] Retry successful!');
            return new Response(JSON.stringify(retryData), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
        
        throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
      }

      const aiData = await aiResponse.json();
      const aiContent = aiData.choices?.[0]?.message?.content;
      console.log('[process-document] AI fallback response:', aiContent);

      try {
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = JSON.parse(aiContent);
        }

        if (!analysis.summary || !analysis.keywords || !analysis.topics || !analysis.complexity_level) {
          throw new Error('Missing required fields in AI response');
        }

        if (!['basic', 'intermediate', 'advanced'].includes(analysis.complexity_level)) {
          analysis.complexity_level = 'intermediate';
        }

      } catch (parseError) {
        console.error('[process-document] Failed to parse AI response:', parseError);
        analysis = {
          summary: 'Documento processato con successo. Analisi AI non disponibile.',
          keywords: ['documento', 'contenuto'],
          topics: ['Generale'],
          complexity_level: 'intermediate'
        };
      }
    }

    // ========================================
    // Extract PDF Metadata (Title and Authors) with Fallback
    // ========================================
    console.log('[process-document] Extracting PDF metadata...');

    const result = await extractMetadataWithFallback(supabase, documentId);

    const extractedTitle = result.title;
    const extractedAuthors = result.authors;

    if (result.success) {
      console.log(`[process-document] ✅ Metadata extracted from ${result.source}:`, 
                  { title: extractedTitle, authors: extractedAuthors });
    } else {
      console.warn('[process-document] ⚠️ Metadata extraction failed');
    }

    // ========================================
    // Create Chunks with Embeddings for Shared Pool
    // ========================================
    console.log('[process-document] Creating chunks for shared pool...');
    
    // Check if chunks already exist for this document
    const { data: existingChunks, error: checkError } = await supabase
      .from('agent_knowledge')
      .select('id')
      .eq('pool_document_id', documentId)
      .limit(1);
    
    if (checkError) {
      console.error('[process-document] Error checking for existing chunks:', checkError);
    }
    
    if (existingChunks && existingChunks.length > 0) {
      console.log('[process-document] ✓ Chunks already exist, skipping chunk creation');
    } else {
      console.log('[process-document] No existing chunks found, creating new chunks...');
      
      // Get document details for chunk metadata
      const { data: doc } = await supabase
        .from('knowledge_documents')
        .select('file_name')
        .eq('id', documentId)
        .single();
      
      const fileName = doc?.file_name || 'Unknown Document';
      
      // Chunk the text
      const chunks = chunkText(fullText, 1000, 200);
      console.log(`[process-document] Created ${chunks.length} chunks`);
      
      // Get OpenAI API key for embeddings
      const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openAIApiKey) {
        throw new Error('OPENAI_API_KEY not configured for embeddings');
      }
      
      // Process chunks in batches
      const BATCH_SIZE = 10;
      let processedChunks = 0;
      const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
      
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const batch = chunks.slice(i, i + BATCH_SIZE);
        
        console.log(`[process-document] Processing batch ${batchNumber}/${totalBatches} (${batch.length} chunks)...`);
        
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
        
        // Insert chunks into agent_knowledge (shared pool)
        const { error: insertError } = await supabase
          .from('agent_knowledge')
          .insert(
            chunksWithEmbeddings.map((chunk) => ({
              agent_id: null,  // NULL = shared pool
              document_name: fileName,
              content: chunk.content,
              embedding: chunk.embedding,
              category: 'General',
              source_type: 'shared_pool',
              pool_document_id: documentId,
            }))
          );
        
        if (insertError) {
          console.error(`[process-document] Batch ${batchNumber} insert error:`, insertError);
          throw insertError;
        }
        
        processedChunks += batch.length;
        console.log(`[process-document] ✓ Batch ${batchNumber}/${totalBatches} completed (${processedChunks}/${chunks.length} chunks)`);
        
        // Small delay between batches
        if (i + BATCH_SIZE < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`[process-document] ✓ All ${processedChunks} chunks created successfully`);
    }
    
    // ========================================
    // Update Database with Analysis
    // ========================================
    console.log('[process-document] Updating database with analysis...');

    await supabase
      .from('knowledge_documents')
      .update({ 
        processing_status: 'ready_for_assignment',
        ai_summary: analysis.summary,
        keywords: analysis.keywords,
        topics: analysis.topics,
        complexity_level: analysis.complexity_level,
        extracted_title: extractedTitle,
        extracted_authors: extractedAuthors,
        processed_at: new Date().toISOString()
      })
      .eq('id', documentId);

    await supabase
      .from('document_processing_cache')
      .update({ 
        processing_completed_at: new Date().toISOString()
      })
      .eq('document_id', documentId);

    // 📬 Send processing complete notification
    const { data: queueData } = await supabase
      .from('pdf_download_queue')
      .select('conversation_id')
      .eq('document_id', documentId)
      .maybeSingle();

    if (queueData?.conversation_id) {
      try {
        const { data: docData } = await supabase
          .from('knowledge_documents')
          .select('file_name')
          .eq('id', documentId)
          .single();
        
        // System message for toast
        await supabase
          .from('agent_messages')
          .insert({
            conversation_id: queueData.conversation_id,
            role: 'system',
            content: `__PDF_READY__${JSON.stringify({
              title: docData?.file_name || 'Unknown Document',
              documentId: documentId,
              summary: analysis.summary
            })}`
          });
        
        // Assistant message for chat feedback
        await supabase
          .from('agent_messages')
          .insert({
            conversation_id: queueData.conversation_id,
            role: 'assistant',
            content: `🎉 **PDF pronto per l'uso**: ${docData?.file_name || 'Unknown Document'}\n\n✨ Il documento è stato elaborato con successo e aggiunto alla document pool. È ora disponibile per essere assegnato agli agenti.\n\n📝 **Riepilogo**: ${analysis.summary}\n\n🏷️ **Parole chiave**: ${analysis.keywords.join(', ')}\n\n📚 **Argomenti**: ${analysis.topics.join(', ')}`
          });
        
        console.log('[process-document] ✓ Processing complete notifications sent');
      } catch (notifError) {
        console.warn('[process-document] ⚠️ Failed to send notification:', notifError);
      }
    }

    console.log('[process-document] Processing completed successfully!');
    console.log('[process-document] ========== END SUCCESS ==========');
    
    clearTimeout(timeoutId);
    
    return new Response(JSON.stringify({
      success: true,
      analysis
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[process-document] ❌ ERROR:', error);
    console.error('[process-document] Stack:', (error as Error).stack);
    console.log('[process-document] ========== END ERROR ==========');
    
    clearTimeout(timeoutId);

    // Try to mark as failed in database
    try {
      const { documentId, retryCount = 0 } = await req.clone().json();
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      await supabase
        .from('knowledge_documents')
        .update({ 
          processing_status: 'processing_failed'
        })
        .eq('id', documentId);

      await supabase
        .from('document_processing_cache')
        .update({ 
          error_message: error instanceof Error ? error.message : 'Processing error',
          retry_count: retryCount
        })
        .eq('document_id', documentId);
      
      // 📬 Send processing failed notification
      const { data: queueData } = await supabase
        .from('pdf_download_queue')
        .select('conversation_id')
        .eq('document_id', documentId)
        .maybeSingle();
      
      if (queueData?.conversation_id) {
        try {
          const { data: docData } = await supabase
            .from('knowledge_documents')
            .select('file_name')
            .eq('id', documentId)
            .maybeSingle();
          
          await supabase
            .from('agent_messages')
            .insert({
              conversation_id: queueData.conversation_id,
              role: 'system',
              content: `__PDF_PROCESSING_FAILED__${JSON.stringify({
                title: docData?.file_name || 'Unknown Document',
                reason: error instanceof Error ? error.message : 'Processing error'
              })}`
            });
          console.log('[process-document] ✓ Processing failed notification sent');
        } catch (notifError) {
          console.warn('[process-document] ⚠️ Failed to send notification:', notifError);
        }
      }
    } catch (dbError) {
      console.error('[process-document] Failed to update error status:', dbError);
    }

    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Processing error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
