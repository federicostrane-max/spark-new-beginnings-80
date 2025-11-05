import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  try {
    const requestBody = await req.json();
    const documentId = requestBody.documentId;
    const expected_title = requestBody.expected_title;
    const expected_author = requestBody.expected_author;

    console.log(`[validate-document] ========== START ==========`);
    console.log(`[validate-document] Input:`, JSON.stringify({
      documentId,
      hasExtractedText: !!requestBody.extractedText,
      hasFullText: !!requestBody.fullText,
      searchQuery: requestBody.searchQuery
    }));
    console.log(`[validate-document] Starting validation for document ${documentId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    const summaryResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
    });

    if (!summaryResponse.ok) {
      const errorText = await summaryResponse.text();
      console.error('[validate-document] AI API error:', summaryResponse.status, errorText);
      
      if (summaryResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (summaryResponse.status === 402) {
        throw new Error('Payment required. Please add credits to your Lovable AI workspace.');
      }
      
      throw new Error(`AI API error: ${summaryResponse.status}`);
    }

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

    const relevanceResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
    });

    if (!relevanceResponse.ok) {
      const errorText = await relevanceResponse.text();
      console.error('[validate-document] AI API error:', relevanceResponse.status, errorText);
      
      if (relevanceResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (relevanceResponse.status === 402) {
        throw new Error('Payment required. Please add credits to your Lovable AI workspace.');
      }
      
      throw new Error(`AI API error: ${relevanceResponse.status}`);
    }

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

    // ✅ VALIDATION PASSED - Save AI summary
    console.log('[validate-document] ✅ Validation successful! Saving AI summary...');

    await supabase
      .from('knowledge_documents')
      .update({ 
        validation_status: 'validated',
        processing_status: 'pending_processing',
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

    await supabase
      .from('document_processing_cache')
      .update({ 
        validation_completed_at: new Date().toISOString()
      })
      .eq('document_id', documentId);

    // Update pdf_download_queue if this download was queued
    const { data: queueEntry } = await supabase
      .from('pdf_download_queue')
      .select('id')
      .eq('document_id', documentId)
      .single();

    if (queueEntry) {
      console.log(`📝 [validate-document] Updating queue entry ${queueEntry.id.slice(0, 8)}`);
      await supabase
        .from('pdf_download_queue')
        .update({
          status: 'completed',
          validation_result: aiResult,
          completed_at: new Date().toISOString()
        })
        .eq('id', queueEntry.id);
    }

    // Trigger processing WITH fullText
    console.log('[validate-document] Triggering document processing with fullText...');
    supabase.functions.invoke('process-document', {
      body: { 
        documentId,
        fullText: requestBody.fullText || extractedText
      }
    }).then(() => console.log('[validate-document] Processing triggered with fullText'))
      .catch((err: Error) => {
        console.error('[validate-document] Failed to trigger processing:', err);
        console.error('[validate-document] Stack:', err.stack);
      });

    console.log('[validate-document] ========== END SUCCESS ==========');
    
    return new Response(JSON.stringify({
      success: true, 
      reason: aiResult.motivazione,
      textLength 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[validate-document] ❌ ERROR:', error);
    console.error('[validate-document] Stack:', (error as Error).stack);
    console.log('[validate-document] ========== END ERROR ==========');
    
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Validation error' 
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
