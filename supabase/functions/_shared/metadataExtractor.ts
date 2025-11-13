import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

interface MetadataResult {
  title: string | null;
  authors: string[] | null;
  source: 'pdf' | 'chunks';
  success: boolean;
  confidence?: 'high' | 'medium' | 'low';
  extractionMethod?: 'vision' | 'text' | 'chunks' | 'filename';
  verifiedOnline?: boolean;
  verifiedSource?: string;
}

/**
 * Estrae metadata con strategia multi-level:
 * 1. Vision-based extraction (primary) - analizza prima pagina PDF con AI vision
 * 2. Text-based extraction (fallback) - estrae da testo con prompt migliorato
 * 3. Web validation (optional) - verifica online esistenza documento
 * 4. Filename fallback (last resort)
 */
export async function extractMetadataWithFallback(
  supabase: any,
  documentId: string,
  filePath?: string,
  fileName?: string,
  enableWebValidation: boolean = true
): Promise<MetadataResult> {
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) {
    throw new Error('LOVABLE_API_KEY not configured');
  }

  console.log(`[metadataExtractor] Starting multi-strategy extraction for ${documentId}`);

  // ========================================
  // STEP 1: Vision-Based Extraction (PRIMARY)
  // ========================================
  try {
    console.log('[metadataExtractor] 🔍 Attempting Vision extraction...');
    const { data: visionData, error: visionError } = await supabase.functions.invoke('extract-metadata-vision', {
      body: { documentId, filePath, fileName }
    });

    if (!visionError && visionData?.success && visionData.confidence === 'high') {
      console.log('[metadataExtractor] ✅ Vision extraction HIGH confidence - using immediately');
      
      // If vision is high confidence, optionally validate online
      if (enableWebValidation && visionData.title) {
        try {
          const { data: validationData } = await supabase.functions.invoke('validate-metadata-online', {
            body: { title: visionData.title, authors: visionData.authors }
          });

          if (validationData?.verified) {
            console.log('[metadataExtractor] ✅ Metadata verified online');
            return {
              ...visionData,
              extractionMethod: 'vision',
              verifiedOnline: true,
              verifiedSource: validationData.source
            };
          }
        } catch (validationError) {
          console.log('[metadataExtractor] ⚠️ Web validation failed, but keeping vision result');
        }
      }

      return {
        ...visionData,
        extractionMethod: 'vision'
      };
    }

    // Store vision result as candidate for later comparison
    if (!visionError && visionData?.success) {
      console.log('[metadataExtractor] 📝 Vision extraction medium/low confidence - will compare with text');
    }
  } catch (visionError) {
    console.log('[metadataExtractor] ⚠️ Vision extraction failed:', visionError);
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
      .limit(20); // Increase to 20 chunks to capture title better

    if (chunksError || !chunks || chunks.length === 0) {
      console.error('[metadataExtractor] ❌ No chunks found for fallback');
      return { 
        title: fileName ? fileName.replace(/\.pdf$/i, '').replace(/_/g, ' ') : null,
        authors: null, 
        source: 'chunks', 
        success: fileName !== null,
        confidence: 'low',
        extractionMethod: 'filename'
      };
    }

    textForExtraction = chunks.map((c: any) => c.content).join('\n\n');
    source = 'chunks';
    console.log(`[metadataExtractor] ✅ Using ${chunks.length} chunks as fallback (${textForExtraction.length} chars)`);
  }

  // ========================================
  // STEP 3: Text-Based Intelligent Extraction
  // ========================================
  console.log('[metadataExtractor] 📄 Attempting text-based extraction with improved prompt...');
  
  const metadataPrompt = `Extract the EXACT title and author(s) from this academic/technical document text.

CRITICAL RULES FOR TITLE EXTRACTION:
1. Look for these patterns that indicate titles:
   - Text after "publication at:" or "DOI:" or "Chapter" markers
   - URLs containing the title (e.g., researchgate.net/publication/123/Title_Here)
   - Standalone prominent text that looks like a book/paper title
   - Text in quotation marks or emphasized formatting
2. Title should be 5-200 characters
3. EXCLUDE: "Abstract:", "Introduction:", "Chapter X", "Section X", page numbers
4. If you see ResearchGate or academic repository URLs, extract title from them
5. Return confidence: "high" if clearly a title, "medium" if uncertain, "low" if not found

AUTHOR EXTRACTION:
- Look for names near the title, after "by", or in affiliation sections
- Common patterns: "Author Name", "Name, University", "Department, Author"
- Multiple authors may be separated by commas or "and"

Document text (first 5000 characters from chunks):
${textForExtraction.slice(0, 5000)}

Return ONLY valid JSON:
{
  "title": "Exact title or null if not found",
  "authors": ["Author 1", "Author 2"] or null,
  "confidence": "high" | "medium" | "low"
}`;

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

    console.log(`[metadataExtractor] 📊 Text extraction result from ${source}:`, metadata);

    // Validate extracted title
    let extractedTitle = metadata.title;
    let confidence: 'high' | 'medium' | 'low' = metadata.confidence || 'medium';
    let extractionMethod: 'text' | 'chunks' | 'filename' = source === 'pdf' ? 'text' : 'chunks';

    // Check for invalid titles
    const invalidPatterns = [
      /^abstract:/i,
      /^introduction:/i,
      /^chapter\s+\d+/i,
      /^\d+$/,
      /^section\s+\d+/i
    ];

    if (!extractedTitle || 
        extractedTitle === 'null' || 
        extractedTitle === 'NULL' ||
        extractedTitle.length < 5 ||
        extractedTitle.length > 200 ||
        invalidPatterns.some(pattern => pattern.test(extractedTitle))) {
      
      console.log('[metadataExtractor] ⚠️ Invalid title detected, using filename fallback');
      extractedTitle = fileName ? fileName.replace(/\.pdf$/i, '').replace(/_/g, ' ') : null;
      confidence = 'low';
      extractionMethod = 'filename';
    }

    // ========================================
    // STEP 4: Web Validation (if enabled and title found)
    // ========================================
    let verifiedOnline = false;
    let verifiedSource: string | undefined;

    if (enableWebValidation && extractedTitle && confidence !== 'low') {
      try {
        console.log('[metadataExtractor] 🌐 Validating metadata online...');
        const { data: validationData, error: validationError } = await supabase.functions.invoke('validate-metadata-online', {
          body: { 
            title: extractedTitle, 
            authors: metadata.authors 
          }
        });

        if (!validationError && validationData) {
          verifiedOnline = validationData.verified;
          verifiedSource = validationData.source;
          
          // Upgrade confidence if verified online
          if (validationData.confidence === 'verified' && confidence === 'medium') {
            confidence = 'high';
            console.log('[metadataExtractor] ⬆️ Upgraded confidence to HIGH based on online verification');
          }
          
          console.log(`[metadataExtractor] ${verifiedOnline ? '✅' : '⚠️'} Online validation: ${validationData.confidence}`);
        }
      } catch (validationError) {
        console.log('[metadataExtractor] ⚠️ Web validation failed:', validationError);
      }
    }

    const result: MetadataResult = {
      title: extractedTitle || null,
      authors: metadata.authors || null,
      source,
      success: extractedTitle !== null,
      confidence,
      extractionMethod,
      verifiedOnline,
      verifiedSource
    };

    console.log('[metadataExtractor] ✅ Final result:', result);
    return result;

  } catch (aiError) {
    console.error('[metadataExtractor] ❌ AI extraction failed:', aiError);
    return { title: null, authors: null, source, success: false };
  }
}
