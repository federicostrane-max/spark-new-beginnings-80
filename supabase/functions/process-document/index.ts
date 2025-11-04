import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessRequest {
  documentId: string;
  fullText?: string; // Complete extracted text (optional, can be fetched from DB)
}

interface AIAnalysis {
  summary: string;
  keywords: string[];
  topics: string[];
  complexity_level: 'basic' | 'intermediate' | 'advanced';
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
    const { documentId, fullText: providedFullText }: ProcessRequest = await req.json();

    console.log(`[process-document] ========== START ==========`);
    console.log(`[process-document] Input:`, JSON.stringify({
      documentId,
      fullTextProvided: !!providedFullText,
      fullTextLength: providedFullText?.length || 0
    }));
    console.log(`[process-document] Starting processing for document ${documentId}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // If fullText is not provided, reconstruct it from agent_knowledge chunks
    let fullText = providedFullText;
    if (!fullText) {
      console.log('[process-document] Full text not provided, reconstructing from chunks...');
      
      const { data: chunks, error: chunksError } = await supabase
        .from('agent_knowledge')
        .select('content')
        .eq('pool_document_id', documentId)
        .order('created_at', { ascending: true });

      if (chunksError || !chunks || chunks.length === 0) {
        throw new Error(`Cannot retrieve chunks for document ${documentId}: ${chunksError?.message || 'No chunks found'}`);
      }

      // Reconstruct full text from chunks (remove potential duplicates from overlap)
      fullText = chunks.map(c => c.content).join(' ');
      console.log(`[process-document] Reconstructed text from ${chunks.length} chunks (${fullText.length} chars)`);
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
    // AI Analysis with Lovable AI (Gemini Flash)
    // ========================================
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Prepare text sample (first 2000 chars for analysis)
    const textSample = fullText.slice(0, 2000);

    const prompt = `Analizza questo estratto di documento PDF e genera metadati strutturati.

TESTO DEL DOCUMENTO:
"""
${textSample}
${fullText.length > 2000 ? '\n...(testo troncato)...' : ''}
"""

Genera un'analisi JSON con:
1. **summary**: Riassunto chiaro in 2-3 frasi di cosa tratta il documento (max 200 caratteri)
2. **keywords**: Array di 5-10 parole chiave principali (termini tecnici, concetti chiave)
3. **topics**: Array di 3-5 argomenti/temi trattati (es: "Machine Learning", "Python", "REST APIs")
4. **complexity_level**: Valuta il livello tecnico: "basic", "intermediate", o "advanced"

IMPORTANTE: Rispondi SOLO con JSON valido in questo formato:
{
  "summary": "Breve descrizione...",
  "keywords": ["keyword1", "keyword2", ...],
  "topics": ["topic1", "topic2", ...],
  "complexity_level": "basic|intermediate|advanced"
}`;

    console.log('[process-document] Calling Lovable AI for document analysis...');

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

    console.log('[process-document] AI response:', aiContent);

    // Parse AI response
    let analysis: AIAnalysis;
    try {
      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        analysis = JSON.parse(aiContent);
      }

      // Validate required fields
      if (!analysis.summary || !analysis.keywords || !analysis.topics || !analysis.complexity_level) {
        throw new Error('Missing required fields in AI response');
      }

      // Ensure complexity_level is valid
      if (!['basic', 'intermediate', 'advanced'].includes(analysis.complexity_level)) {
        analysis.complexity_level = 'intermediate'; // Default fallback
      }

    } catch (parseError) {
      console.error('[process-document] Failed to parse AI response:', parseError);
      
      // Fallback analysis
      analysis = {
        summary: 'Documento processato con successo. Analisi AI non disponibile.',
        keywords: ['documento', 'contenuto'],
        topics: ['Generale'],
        complexity_level: 'intermediate'
      };
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
        processed_at: new Date().toISOString()
      })
      .eq('id', documentId);

    await supabase
      .from('document_processing_cache')
      .update({ 
        processing_completed_at: new Date().toISOString()
      })
      .eq('document_id', documentId);

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
      const { documentId } = await req.clone().json();
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
          retry_count: 0 // Could increment for retry logic
        })
        .eq('document_id', documentId);
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
