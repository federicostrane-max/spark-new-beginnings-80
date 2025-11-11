import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALIDATION_TIMEOUT = 300000; // 5 minuti

/**
 * Helper per verificare timeout durante validazione
 */
function checkTimeout(startTime: number, context: string) {
  if (Date.now() - startTime > VALIDATION_TIMEOUT) {
    throw new Error(`Validation timeout exceeded (5 minutes) at ${context}`);
  }
}

/**
 * Wrapper per chiamate AI con retry automatico su rate limit
 */
async function callAIWithRetry(url: string, options: any, startTime: number, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      checkTimeout(startTime, `AI call attempt ${attempt + 1}`);
      
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.log(`[validate-document] ⏳ Rate limited, retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[validate-document] AI API error:`, response.status, errorText);
        
        if (response.status === 402) {
          throw new Error('Payment required. Please add credits to your Lovable AI workspace.');
        }
        
        throw new Error(`AI API error: ${response.status}`);
      }
      
      return response;
    } catch (error: any) {
      if (attempt === maxRetries - 1) {
        throw error;
      }
      console.log(`[validate-document] ⚠️ Attempt ${attempt + 1} failed, retrying...`);
    }
  }
  throw new Error('All retry attempts failed');
}

interface ValidationRequest {
  documentId: string;
  searchQuery: string;
  extractedText: string; // First 500-1000 chars
  fullText?: string; // Complete text for processing
}

interface ValidationResult {
  isValid: boolean;
  reason: string;
  textLength: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ⚠️ CRITICAL WORKFLOW NOTE:
  // This function ONLY validates documents and generates AI summaries.
  // It MUST NEVER create agent_document_links or assign documents to agents.
  // Documents stay in the shared pool after validation.
  // Assignment is done later by users through the DocumentPool UI.
  // NEVER use 'ai_assigned' assignment type.

  let requestBody: any;
  let supabase: any;
  
  try {
    const startTime = Date.now(); // ✅ Track validation start time
    
    requestBody = await req.json();
    const documentId = requestBody.documentId;
    const expected_title = requestBody.expected_title;
    const expected_author = requestBody.expected_author;

    console.log(`[validate-document] ========== START (timeout: ${VALIDATION_TIMEOUT}ms) ==========`);
    console.log(`[validate-document] Input:`, JSON.stringify({
      documentId,
      hasExtractedText: !!requestBody.extractedText,
      hasFullText: !!requestBody.fullText,
      searchQuery: requestBody.searchQuery
    }));
    console.log(`[validate-document] Starting validation for document ${documentId}`);

    // ========================================
    // IDEMPOTENCY CHECK
    // ========================================
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    // Check if already validated or processing
    const { data: docCheck, error: checkError } = await supabase
      .from('knowledge_documents')
      .select('validation_status, processing_status, validation_date')
      .eq('id', documentId)
      .single();

    if (checkError) {
      console.error('[validate-document] Error checking document status:', checkError);
      // Continue with validation
    } else if (docCheck) {
      // Skip if already validated
      if (docCheck.validation_date && docCheck.validation_status === 'validated') {
        console.log('[validate-document] ⏭️ Document already validated, skipping...');
        return new Response(JSON.stringify({
          success: true,
          reason: 'Document already validated',
          skipped: true
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Skip if already in ready_for_assignment status
      if (docCheck.processing_status === 'ready_for_assignment') {
        console.log('[validate-document] ⏭️ Document already ready for assignment, skipping...');
        return new Response(JSON.stringify({
          success: true,
          reason: 'Document already processed',
          skipped: true
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get document info
    const { data: doc, error: docError } = await supabase
      .from('knowledge_documents')
      .select('file_path, search_query')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      throw new Error('Document not found');
    }

    // Update status to validating
    await supabase
      .from('knowledge_documents')
      .update({ 
        validation_status: 'validating',
        processing_status: 'validating'
      })
      .eq('id', documentId);

    await supabase
      .from('document_processing_cache')
      .upsert({ 
        document_id: documentId,
        validation_started_at: new Date().toISOString() 
      });

    // Extract text from PDF (simplified - just get file metadata for now)
    // In a real implementation, you'd download and parse the PDF here
    let extractedText = requestBody.extractedText;
    let searchQuery = requestBody.searchQuery || doc.search_query || '';

    // If no extracted text provided, extract it from storage
    if (!extractedText || extractedText.trim().length < 10) {
      console.log('[validate-document] No extracted text, calling extract-pdf-text function...');
      
      const { data: extractionResult, error: extractionError } = await supabase.functions.invoke('extract-pdf-text', {
        body: { documentId }
      });
      
      if (extractionError) {
        console.error('[validate-document] Text extraction failed:', extractionError);
        // Continue without extracted text - will be marked as validated but needs manual review
      } else if (extractionResult?.text) {
        extractedText = extractionResult.text;
        console.log(`[validate-document] ✅ Text extracted: ${extractedText.length} chars`);
      } else {
        console.warn('[validate-document] No text extracted from PDF');
      }
    }

    // If still no extracted text after extraction attempt, skip AI validation
    if (!extractedText || extractedText.trim().length < 10) {
      console.log('[validate-document] No extracted text, marking as validated');
      
      await supabase
        .from('knowledge_documents')
        .update({ 
          validation_status: 'validated',
          processing_status: 'pending_processing',
          validation_reason: 'Documento accettato (validazione AI saltata)',
          validation_date: new Date().toISOString(),
          text_length: 0
        })
        .eq('id', documentId);

      await supabase
        .from('document_processing_cache')
        .update({ 
          validation_completed_at: new Date().toISOString()
        })
        .eq('document_id', documentId);
      
      // Trigger processing WITH fullText
      supabase.functions.invoke('process-document', {
        body: { 
          documentId,
          fullText: requestBody.fullText || ''
        }
      }).then(() => console.log('[validate-document] Processing triggered (no text)'));

      console.log('[validate-document] ========== END (NO TEXT) ==========');
      
      return new Response(JSON.stringify({
        success: true, 
        reason: 'Documento accettato per il processing',
        textLength: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========================================
    // STEP 1: Technical Validation
    // ========================================
    const textLength = extractedText.trim().length;
    
    // Check 1: Minimum text length (100 chars)
    if (textLength < 100) {
      const reason = `Testo insufficiente: solo ${textLength} caratteri (minimo 100). Il PDF potrebbe essere vuoto o contenere solo immagini.`;
      await markValidationFailed(supabase, documentId, reason, textLength);
      return new Response(JSON.stringify({ 
        success: false, 
        reason 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    console.log(`[validate-document] Technical validation passed (${textLength} chars)`);

    // ========================================
    // STEP 2: Generate Complete AI Summary
    // ========================================
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    checkTimeout(startTime, 'before AI summary generation');
    console.log('[validate-document] Generating complete AI summary for validation...');

    const summaryPrompt = `Analizza questo documento e genera un riepilogo strutturato completo.

TESTO COMPLETO DEL DOCUMENTO:
"""
${extractedText}
"""

Genera un'analisi completa che includa:
1. Un riepilogo dettagliato del contenuto (3-5 frasi)
2. I concetti chiave e argomenti principali
3. Le parole chiave più rilevanti
4. Il livello di complessità del documento

Rispondi SOLO con questo formato JSON:
{
  "summary": "Riepilogo dettagliato del documento in 3-5 frasi",
  "keywords": ["parola1", "parola2", "parola3", ...],
  "topics": ["argomento1", "argomento2", ...],
  "complexity_level": "beginner|intermediate|advanced"
}`;

    // ✅ Use retry logic for AI call
    const summaryResponse = await callAIWithRetry(
      'https://ai.gateway.lovable.dev/v1/chat/completions',
      {
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
              content: 'Sei un esperto di analisi documentale. Rispondi SOLO con JSON valido nel formato richiesto.' 
            },
            { role: 'user', content: summaryPrompt }
          ],
          temperature: 0.3,
        }),
      },
      startTime
    );

    const summaryData = await summaryResponse.json();
    const summaryContent = summaryData.choices?.[0]?.message?.content;

    console.log('[validate-document] AI summary response:', summaryContent);

    // Parse summary response
    let aiSummary: { summary: string; keywords: string[]; topics: string[]; complexity_level: string };
    try {
      const jsonMatch = summaryContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiSummary = JSON.parse(jsonMatch[0]);
      } else {
        aiSummary = JSON.parse(summaryContent);
      }
    } catch (parseError) {
      console.error('[validate-document] Failed to parse AI summary:', parseError);
      throw new Error('Failed to generate document summary');
    }

    // ========================================
    // STEP 3: Validate Relevance Using Summary
    // ========================================
    checkTimeout(startTime, 'before relevance validation');
    console.log('[validate-document] Validating relevance using generated summary...');

    const relevancePrompt = `Query di ricerca originale: "${searchQuery}"

TITOLO ATTESO: "${expected_title || 'N/A'}"
AUTORE ATTESO: "${expected_author || 'N/A'}"

RIEPILOGO COMPLETO DEL DOCUMENTO:
${aiSummary.summary}

PAROLE CHIAVE:
${aiSummary.keywords.join(', ')}

ARGOMENTI:
${aiSummary.topics.join(', ')}

Valuta se questo documento è DAVVERO RILEVANTE per la query di ricerca.

SII RIGOROSO: accetta solo documenti che trattano DIRETTAMENTE l'argomento cercato.
Un documento può sembrare correlato ma non essere realmente pertinente al topic specifico.

Considera:
- Il titolo del PDF corrisponde al titolo atteso? (confronto flessibile)
- L'autore corrisponde se specificato?
- Il contenuto del documento (dal riepilogo) tratta DIRETTAMENTE l'argomento cercato?
- Le parole chiave e gli argomenti sono STRETTAMENTE correlati alla query?

Rispondi SOLO con questo formato JSON:
{
  "rilevante": true/false,
  "motivazione": "Spiegazione breve in 2-3 frasi del perché è rilevante o non rilevante",
  "confidence": 0-100
}

Se confidence < 70, considera il documento NON rilevante.`;

    // ✅ Use retry logic for AI call
    const relevanceResponse = await callAIWithRetry(
      'https://ai.gateway.lovable.dev/v1/chat/completions',
      {
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
              content: 'Sei un validatore rigoroso di documenti. Rispondi SOLO con JSON valido nel formato richiesto. Sii critico e accetta solo documenti davvero pertinenti.' 
            },
            { role: 'user', content: relevancePrompt }
          ],
          temperature: 0.3,
        }),
      },
      startTime
    );

    const relevanceData = await relevanceResponse.json();
    const relevanceContent = relevanceData.choices?.[0]?.message?.content;

    console.log('[validate-document] AI relevance response:', relevanceContent);

    // Parse relevance response
    let aiResult: { rilevante: boolean; motivazione: string; confidence?: number };
    try {
      const jsonMatch = relevanceContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiResult = JSON.parse(jsonMatch[0]);
      } else {
        aiResult = JSON.parse(relevanceContent);
      }
      
      // Apply confidence threshold
      if (aiResult.confidence !== undefined && aiResult.confidence < 70) {
        aiResult.rilevante = false;
        aiResult.motivazione = `Bassa confidenza (${aiResult.confidence}%): ${aiResult.motivazione}`;
      }
    } catch (parseError) {
      console.error('[validate-document] Failed to parse AI relevance response:', parseError);
      // Fallback: assume relevant if parsing fails
      aiResult = { 
        rilevante: true, 
        motivazione: 'Validazione AI fallita, documento accettato per sicurezza.' 
      };
    }

    // ========================================
    // STEP 4: Final Decision
    // ========================================
    if (!aiResult.rilevante) {
      const reason = `Non rilevante per la ricerca: ${aiResult.motivazione}`;
      console.log(`[validate-document] ❌ Document rejected: ${reason}`);
      
      // Delete document from storage
      const { error: deleteStorageError } = await supabase.storage
        .from('knowledge-pdfs')
        .remove([doc.file_path]);
      
      if (deleteStorageError) {
        console.error('[validate-document] Failed to delete from storage:', deleteStorageError);
      } else {
        console.log('[validate-document] ✅ Document deleted from storage');
      }
      
      // Delete from database
      await supabase
        .from('knowledge_documents')
        .delete()
        .eq('id', documentId);
      
      await supabase
        .from('document_processing_cache')
        .delete()
        .eq('document_id', documentId);
      
      // Update queue entry if exists
      const { data: queueEntry } = await supabase
        .from('pdf_download_queue')
        .select('id')
        .eq('document_id', documentId)
        .single();

      if (queueEntry) {
        await supabase
          .from('pdf_download_queue')
          .update({
            status: 'rejected',
            error_message: reason,
            validation_result: aiResult,
            completed_at: new Date().toISOString()
          })
          .eq('id', queueEntry.id);
      }
      
      return new Response(JSON.stringify({ 
        success: false, 
        reason,
        deleted: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    // ✅ VALIDATION PASSED - Update to VALIDATED status
    console.log('[validate-document] ✅ Validation successful! Updating status to VALIDATED...');

    // STEP 4A: Update document status to VALIDATED (BEFORE triggering processing)
    const { error: updateError } = await supabase
      .from('knowledge_documents')
      .update({ 
        validation_status: 'validated',
        processing_status: 'validated',
        validation_reason: `Documento valido: ${aiResult.motivazione}`,
        validation_date: new Date().toISOString(),
        text_length: textLength,
        // Save the AI-generated metadata
        ai_summary: aiSummary.summary,
        keywords: aiSummary.keywords,
        topics: aiSummary.topics,
        complexity_level: aiSummary.complexity_level
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('[validate-document] ❌ CRITICAL: Failed to update status to VALIDATED:', updateError);
      throw new Error(`Failed to mark document as validated: ${updateError.message}`);
    }

    console.log('[validate-document] ✓ Status successfully updated to VALIDATED');

    // STEP 4B: Update processing cache
    const { error: cacheError } = await supabase
      .from('document_processing_cache')
      .update({ 
        validation_completed_at: new Date().toISOString()
      })
      .eq('document_id', documentId);

    if (cacheError) {
      console.warn('[validate-document] ⚠️ Failed to update processing cache:', cacheError);
      // Non-fatal, continue
    }

    // STEP 4C: Update pdf_download_queue if this download was queued
    const { data: queueEntry } = await supabase
      .from('pdf_download_queue')
      .select('id, conversation_id')
      .eq('document_id', documentId)
      .single();

    if (queueEntry) {
      console.log(`[validate-document] Updating queue entry ${queueEntry.id.slice(0, 8)}...`);
      const { error: queueError } = await supabase
        .from('pdf_download_queue')
        .update({
          status: 'completed',
          validation_result: aiResult,
          completed_at: new Date().toISOString()
        })
        .eq('id', queueEntry.id);
      
      if (queueError) {
        console.warn('[validate-document] ⚠️ Failed to update queue entry:', queueError);
        // Non-fatal, continue
      }

      // STEP 4D: Send real-time notification to user
      if (queueEntry.conversation_id) {
        console.log(`[validate-document] 📬 Sending validation notification to conversation ${queueEntry.conversation_id.slice(0, 8)}...`);
        try {
          const { data: docData } = await supabase
            .from('knowledge_documents')
            .select('file_name')
            .eq('id', documentId)
            .single();

          await supabase
            .from('agent_messages')
            .insert({
              conversation_id: queueEntry.conversation_id,
              role: 'system',
              content: `__PDF_VALIDATED__${JSON.stringify({
                title: docData?.file_name || 'Unknown Document',
                documentId: documentId
              })}`
            });
          console.log('[validate-document] ✓ Notification sent successfully');
        } catch (notifError) {
          console.warn('[validate-document] ⚠️ Failed to send notification:', notifError);
          // Non-fatal, continue
        }
      }
    }

    // STEP 5: Trigger processing (AFTER status is confirmed as VALIDATED)
    console.log('[validate-document] 🚀 Triggering document processing...');
    try {
      await supabase.functions.invoke('process-document', {
        body: { 
          documentId,
          fullText: requestBody.fullText || extractedText
        }
      });
      console.log('[validate-document] ✓ Processing triggered successfully');
    } catch (processError) {
      console.error('[validate-document] ⚠️ Failed to trigger processing (non-fatal):', processError);
      console.error('[validate-document] Stack:', (processError as Error).stack);
      // Don't throw - document is already validated, processing can be retried later
    }

    console.log('[validate-document] ========== END SUCCESS ==========');
    
    return new Response(JSON.stringify({
      success: true, 
      reason: aiResult.motivazione,
      textLength 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
    console.error('[validate-document] ❌ FATAL ERROR');
    console.error('[validate-document] Document ID:', requestBody?.documentId || 'unknown');
    console.error('[validate-document] Error:', errorMessage);
    console.error('[validate-document] Stack:', (error as Error).stack);
    console.log('[validate-document] ========== END ERROR ==========');
    
    // ✅ CRITICAL FIX: Update document status to validation_failed
    try {
      if (requestBody?.documentId) {
        await markValidationFailed(
          supabase,
          requestBody.documentId,
          `Validation exception: ${errorMessage}`,
          0
        );
        console.log('[validate-document] ✓ Document marked as validation_failed');
      }
    } catch (updateError) {
      console.error('[validate-document] ❌ Failed to update error status:', updateError);
    }
    
    return new Response(JSON.stringify({
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Helper function to mark validation as failed
async function markValidationFailed(
  supabase: any, 
  documentId: string, 
  reason: string, 
  textLength: number
) {
  await supabase
    .from('knowledge_documents')
    .update({ 
      validation_status: 'validation_failed',
      processing_status: 'validation_failed',
      validation_reason: reason,
      validation_date: new Date().toISOString(),
      text_length: textLength
    })
    .eq('id', documentId);

  await supabase
    .from('document_processing_cache')
    .update({ 
      validation_completed_at: new Date().toISOString(),
      error_message: reason
    })
    .eq('document_id', documentId);

  // Update pdf_download_queue if exists
  const { data: queueEntry } = await supabase
    .from('pdf_download_queue')
    .select('id')
    .eq('document_id', documentId)
    .single();

  if (queueEntry) {
    await supabase
      .from('pdf_download_queue')
      .update({
        status: 'failed',
        error_message: reason,
        completed_at: new Date().toISOString()
      })
      .eq('id', queueEntry.id);
  }
}
