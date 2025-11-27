import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

// ============= INTERFACES =============

export interface OCRIssue {
  type: 'malformed_date' | 'garbage_text' | 'special_chars';
  pattern: string;
  severity: 'high' | 'medium' | 'low';
}

// ============= FUNCTION 1: DETECTION AUTOMATICA =============

export function detectOCRIssues(text: string): OCRIssue[] {
  const issues: OCRIssue[] = [];

  // Pattern 1: Date malformate (es. "1/8/8" invece di "1/8/93")
  // Cattura date con 2 cifre nell'anno seguite da spazio o fine riga (non da altra cifra o /)
  const malformedDateRegex = /\b\d{1,2}\/\d{1,2}\/\d{1,2}\b(?!\/|\d)/g;
  let match: RegExpExecArray | null;
  
  while ((match = malformedDateRegex.exec(text)) !== null) {
    issues.push({
      type: 'malformed_date',
      pattern: match[0],
      severity: 'high'
    });
  }

  // Pattern 2: Testo spazzatura (es. "UsC:u qA fa respase")
  // Rileva pattern di lettere maiuscole/minuscole con separatori strani
  const garbageTextRegex = /[A-Z][a-z]?:[a-z]{1,3}\s+[a-z]{1,3}\s+[a-z]+/gi;
  malformedDateRegex.lastIndex = 0; // Reset regex
  
  while ((match = garbageTextRegex.exec(text)) !== null) {
    issues.push({
      type: 'garbage_text',
      pattern: match[0],
      severity: 'high'
    });
  }

  // Pattern 3: Caratteri speciali consecutivi (3+)
  const specialCharsRegex = /[^a-zA-Z0-9\s.,;:!?'"()-]{3,}/g;
  garbageTextRegex.lastIndex = 0; // Reset regex
  
  while ((match = specialCharsRegex.exec(text)) !== null) {
    issues.push({
      type: 'special_chars',
      pattern: match[0],
      severity: 'medium'
    });
  }

  return issues;
}

// ============= FUNCTION 2A: PDF TO IMAGE CONVERSION =============

export async function convertPdfToImage(
  pdfBuffer: Uint8Array,
  cloudmersiveKey: string
): Promise<string | null> {
  console.log('[Vision Enhancement] Converting PDF to PNG via Cloudmersive');
  console.log(`[Vision Enhancement] PDF buffer size: ${pdfBuffer.length} bytes`);

  try {
    // Create FormData with PDF - use type assertion to satisfy Deno's strict typing
    const formData = new FormData();
    const file = new File([pdfBuffer as unknown as BlobPart], 'document.pdf', { type: 'application/pdf' });
    formData.append('file', file);

    console.log('[Vision Enhancement] Calling Cloudmersive API...');
    const response = await fetch(
      'https://api.cloudmersive.com/convert/pdf/to/png/direct',
      {
        method: 'POST',
        headers: { 'Apikey': cloudmersiveKey },
        body: formData
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Vision Enhancement] Cloudmersive error ${response.status}:`, errorText);
      throw new Error(`Cloudmersive API failed: ${response.status} - ${errorText}`);
    }

    // Returns first page as PNG
    const pngBuffer = await response.arrayBuffer();
    const base64Image = encodeBase64(new Uint8Array(pngBuffer));
    console.log(`[Vision Enhancement] PDF converted to PNG, base64 length: ${base64Image.length} chars`);
    
    return base64Image;

  } catch (error) {
    console.error('[Vision Enhancement] Exception in convertPdfToImage:', error);
    throw error;
  }
}

// ============= FUNCTION 2B: CLAUDE VISION WITH CONTEXTUAL REASONING =============

export async function enhanceWithClaudeVision(
  imageBase64: string,
  anthropicKey: string,
  ocrIssues: OCRIssue[]
): Promise<string | null> {
  console.log('[Vision Enhancement] Starting Claude Vision analysis');
  console.log(`[Vision Enhancement] Image base64 length: ${imageBase64.length} chars, OCR issues: ${ocrIssues.length}`);

  try {
    const issuesList = ocrIssues.map(i => `- ${i.type}: "${i.pattern}"`).join('\n');
    
    const contextualPrompt = `Trascrivi TUTTO il testo visibile in questo documento con MASSIMA PRECISIONE.

ATTENZIONE CRITICA - PROBLEMI OCR RILEVATI:
L'OCR precedente ha estratto questi valori probabilmente errati:
${issuesList}

ISTRUZIONI SPECIALI PER DATE AMBIGUE:
1. Se vedi una data parzialmente illeggibile (es. "1/8/??" o "1/8/8"), 
   CERCA ALTRE DATE nel documento per inferire l'anno corretto.
2. In particolare, se "PROPOSED RELEASE DATE" mostra "1/8/93", 
   è ALTAMENTE PROBABILE che la data principale sia anch'essa del 1993.
3. Usa il CONTESTO SEMANTICO: in un documento di approvazione aziendale,
   la data del documento e la data di rilascio proposta sono tipicamente vicine.
4. NON inventare - se non riesci a dedurre con sicurezza, indica l'incertezza.

ISTRUZIONI PER TESTO CORROTTO:
- Se vedi caratteri illeggibili, prova a dedurre dal contesto.
- Preserva la struttura del documento (tabelle, liste, intestazioni).

OBIETTIVO: Produrre una trascrizione accurata dove le date ambigue 
sono RISOLTE usando il contesto disponibile nel documento stesso.`;

    console.log('[Vision Enhancement] Calling Claude API...');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: contextualPrompt
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Vision Enhancement] Claude API error ${response.status}:`, errorText);
      throw new Error(`Claude API failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const extractedText = result.content?.[0]?.text;
    
    console.log(`[Vision Enhancement] Claude extracted ${extractedText?.length || 0} characters`);
    return extractedText || null;

  } catch (error) {
    console.error('[Vision Enhancement] Exception in enhanceWithClaudeVision:', error);
    throw error;
  }
}

// ============= FUNCTION 2C: GOOGLE VISION API CALL =============

export async function enhanceWithVisionAPI(
  pdfBuffer: Uint8Array,
  apiKey: string
): Promise<string | null> {
  console.log('[Vision Enhancement] Starting Google Cloud Vision API call');
  console.log(`[Vision Enhancement] PDF buffer size: ${pdfBuffer.length} bytes`);

  try {
    // Converti PDF in base64 usando Deno standard library (safe for large buffers)
    const base64PDF = encodeBase64(pdfBuffer);
    console.log(`[Vision Enhancement] Base64 encoding completed: ${base64PDF.length} chars`);

    // Chiama Google Cloud Vision files:annotate
    const apiUrl = `https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`;
    const requestBody = {
      requests: [{
        inputConfig: {
          content: base64PDF,
          mimeType: 'application/pdf'
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
      }]
    };

    console.log('[Vision Enhancement] Calling Google Cloud Vision API...');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Vision Enhancement] API error ${response.status}:`, errorText);
      throw new Error(`Google Cloud Vision API failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('[Vision Enhancement] API response received');
    
    // Debug logging per struttura risposta
    console.log('[Vision Enhancement] Response structure:', JSON.stringify(Object.keys(result)));
    console.log('[Vision Enhancement] Responses count:', result.responses?.length);
    if (result.responses?.[0]) {
      console.log('[Vision Enhancement] First response keys:', JSON.stringify(Object.keys(result.responses[0])));
    }

    // Per files:annotate (PDF), la struttura è: responses[file].responses[page]
    const fileResponse = result.responses?.[0];
    if (!fileResponse) {
      console.warn('[Vision Enhancement] No file response from Vision API');
      return null;
    }

    // Accedi alle risposte delle pagine (struttura nidificata per PDF)
    const pageResponses = fileResponse.responses || [];
    if (pageResponses.length === 0) {
      console.warn('[Vision Enhancement] No page responses from Vision API');
      console.log('[Vision Enhancement] File response structure:', JSON.stringify(Object.keys(fileResponse)));
      return null;
    }

    let fullText = '';
    for (let i = 0; i < pageResponses.length; i++) {
      const pageResponse = pageResponses[i];
      const fullTextAnnotation = pageResponse.fullTextAnnotation;
      
      if (fullTextAnnotation && fullTextAnnotation.text) {
        fullText += fullTextAnnotation.text;
        if (i < pageResponses.length - 1) {
          fullText += '\n\n---PAGE BREAK---\n\n';
        }
      } else {
        console.log(`[Vision Enhancement] Page ${i + 1}: No text annotation found`);
      }
    }

    console.log(`[Vision Enhancement] Extracted ${fullText.length} characters from ${pageResponses.length} page(s)`);
    return fullText.trim();

  } catch (error) {
    console.error('[Vision Enhancement] Exception in enhanceWithVisionAPI:', error);
    throw error;
  }
}

// ============= FUNCTION 3: MERGE ADDITIVO =============

export function buildEnhancedSuperDocument(
  originalSuperDoc: string,
  visionText: string,
  issues: OCRIssue[]
): string {
  const enhancedSection = `

---
## 🔍 HIGH-CONFIDENCE VISUAL TRANSCRIPTION

**⚠️ ISTRUZIONE PER L'AGENTE**: Questa sezione contiene una trascrizione ad alta affidabilità generata da AI Vision Analysis. Quando il testo originale sopra mostra dati corrotti o illeggibili, usa i valori di questa sezione. Problemi rilevati nel testo originale: ${issues.map(i => i.pattern).join(', ')}.

**TRASCRIZIONE CORRETTA:**
${visionText}

---`;

  return originalSuperDoc + enhancedSection;
}
