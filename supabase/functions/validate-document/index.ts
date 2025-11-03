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
    const { documentId, searchQuery, extractedText }: ValidationRequest = await req.json();

    console.log(`[validate-document] Starting validation for document ${documentId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
      .update({ validation_started_at: new Date().toISOString() })
      .eq('document_id', documentId);

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
    // STEP 2: AI Relevance Check (Gemini Flash)
    // ========================================
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const prompt = `Query di ricerca originale: "${searchQuery}"

Campione di testo estratto dal PDF (primi 500 caratteri):
"""
${extractedText.slice(0, 500)}
"""

Valuta se questo documento è RILEVANTE per la query di ricerca.

Considera:
- Il documento tratta l'argomento cercato?
- Le informazioni sembrano utili per rispondere alla query?
- Il contenuto è coerente con quello che ci si aspetta?

Rispondi SOLO con questo formato JSON:
{
  "rilevante": true/false,
  "motivazione": "Spiegazione breve in 1-2 frasi del perché è rilevante o non rilevante"
}`;

    console.log('[validate-document] Calling Lovable AI for relevance check...');

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
            content: 'Sei un validatore di documenti. Rispondi SOLO con JSON valido nel formato richiesto.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[validate-document] AI API error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (aiResponse.status === 402) {
        throw new Error('Payment required. Please add credits to your Lovable AI workspace.');
      }
      
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content;

    console.log('[validate-document] AI response:', aiContent);

    // Parse AI response
    let aiResult: { rilevante: boolean; motivazione: string };
    try {
      // Try to extract JSON from the response (in case AI adds extra text)
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiResult = JSON.parse(jsonMatch[0]);
      } else {
        aiResult = JSON.parse(aiContent);
      }
    } catch (parseError) {
      console.error('[validate-document] Failed to parse AI response:', parseError);
      // Fallback: assume relevant if parsing fails
      aiResult = { 
        rilevante: true, 
        motivazione: 'Validazione AI fallita, documento accettato per sicurezza.' 
      };
    }

    // ========================================
    // STEP 3: Final Decision
    // ========================================
    if (!aiResult.rilevante) {
      const reason = `Non rilevante per la ricerca: ${aiResult.motivazione}`;
      await markValidationFailed(supabase, documentId, reason, textLength);
      
      return new Response(JSON.stringify({ 
        success: false, 
        reason 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    // ✅ VALIDATION PASSED
    console.log('[validate-document] Validation successful!');

    await supabase
      .from('knowledge_documents')
      .update({ 
        validation_status: 'validated',
        processing_status: 'validated',
        validation_reason: `Documento valido: ${aiResult.motivazione}`,
        validation_date: new Date().toISOString(),
        text_length: textLength
      })
      .eq('id', documentId);

    await supabase
      .from('document_processing_cache')
      .update({ 
        validation_completed_at: new Date().toISOString()
      })
      .eq('document_id', documentId);

    return new Response(JSON.stringify({ 
      success: true, 
      reason: aiResult.motivazione,
      textLength 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[validate-document] Error:', error);
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
}
