import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

interface MetadataResult {
  title: string | null;
  authors: string[] | null;
  source: 'pdf' | 'chunks';
  success: boolean;
}

/**
 * Estrae metadata con fallback automatico:
 * 1. Tenta estrazione da PDF originale
 * 2. Se PDF non disponibile, usa chunks esistenti
 */
export async function extractMetadataWithFallback(
  supabase: any,
  documentId: string,
  filePath?: string,
  fileName?: string
): Promise<MetadataResult> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) {
    throw new Error('LOVABLE_API_KEY not configured');
  }

  let textForExtraction = '';
  let source: 'pdf' | 'chunks' = 'pdf';

  // ========================================
  // STEP 1: Tentativo primario - PDF
  // ========================================
  try {
    console.log('[metadataExtractor] Attempting PDF extraction...');
    const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-pdf-text', {
      body: { documentId, filePath }
    });

    if (!extractError && extractData?.text) {
      textForExtraction = extractData.text;
      source = 'pdf';
      console.log('[metadataExtractor] ✅ PDF extraction successful');
    } else {
      throw new Error('PDF extraction failed');
    }
  } catch (pdfError) {
    console.log('[metadataExtractor] ⚠️ PDF extraction failed, trying chunk fallback...');

    // ========================================
    // STEP 2: Fallback automatico - Chunks
    // ========================================
    const { data: chunks, error: chunksError } = await supabase
      .from('agent_knowledge')
      .select('content')
      .eq('pool_document_id', documentId)
      .order('created_at', { ascending: true })
      .limit(10); // Prime 10 chunks (di solito contengono titolo/autori)

    if (chunksError || !chunks || chunks.length === 0) {
      console.error('[metadataExtractor] ❌ No chunks found for fallback');
      return { title: null, authors: null, source: 'chunks', success: false };
    }

    textForExtraction = chunks.map((c: any) => c.content).join('\n\n');
    source = 'chunks';
    console.log(`[metadataExtractor] ✅ Using ${chunks.length} chunks as fallback (${textForExtraction.length} chars)`);
  }

  // ========================================
  // STEP 3: Estrazione metadata con AI
  // ========================================
  const metadataPrompt = `Extract the EXACT title and author(s) from this document text.
The title is usually found at the beginning or in the first pages.
Return ONLY a JSON object with this structure:
{
  "title": "Exact title as written in the document",
  "authors": ["Author 1", "Author 2"]
}

Document text (first 3000 characters):
${textForExtraction.slice(0, 3000)}`;

  try {
    const metadataResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: metadataPrompt }],
        response_format: { type: 'json_object' }
      })
    });

    if (!metadataResponse.ok) {
      throw new Error(`AI API error: ${metadataResponse.status}`);
    }

    const metadataData = await metadataResponse.json();
    let content = metadataData.choices[0].message.content;
    
    // Remove markdown code blocks if present
    content = content.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    
    const metadata = JSON.parse(content);

    console.log(`[metadataExtractor] ✅ Metadata extracted from ${source}:`, metadata);

    // Se l'AI ritorna "null" come stringa o null, usa il nome file come fallback
    let extractedTitle = metadata.title;
    if (!extractedTitle || extractedTitle === 'null' || extractedTitle === 'NULL') {
      console.log('[metadataExtractor] ⚠️ AI returned null/invalid title, using filename as fallback');
      extractedTitle = fileName ? fileName.replace(/\.pdf$/i, '').replace(/_/g, ' ') : null;
    }

    return {
      title: extractedTitle || null,
      authors: metadata.authors || null,
      source,
      success: extractedTitle !== null
    };

  } catch (aiError) {
    console.error('[metadataExtractor] ❌ AI extraction failed:', aiError);
    return { title: null, authors: null, source, success: false };
  }
}
