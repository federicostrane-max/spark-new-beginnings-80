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


// ============= FUNCTION 2B: CLAUDE PDF WITH CONTEXTUAL REASONING =============

/**
 * Enhances extracted text using Claude's native PDF support (Nov 2024 feature) + RETRY AUTOMATICO
 * Eliminates the need for PDF-to-image conversion via Cloudmersive
 * 🛡️ RESILIENZA: 3 retry automatici con backoff esponenziale su errori 500/502/503
 * @param pdfBuffer Raw PDF file buffer
 * @param anthropicKey Anthropic API key
 * @param ocrIssues Array of detected OCR issues to guide Claude's contextual reasoning
 */
export async function enhanceWithClaudePDF(
  pdfBuffer: Uint8Array,
  anthropicKey: string,
  ocrIssues: OCRIssue[]
): Promise<string | null> {
  console.log('[Vision Enhancement] Using Claude native PDF support (no conversion needed)');
  console.log(`[Vision Enhancement] PDF buffer size: ${pdfBuffer.length} bytes, OCR issues: ${ocrIssues.length}`);

  const base64Pdf = encodeBase64(pdfBuffer);
  console.log(`[Vision Enhancement] PDF encoded to base64: ${base64Pdf.length} chars`);
  
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

  // 🛡️ RESILIENZA: Wrapper con retry automatico
  const callClaudeAPI = async (): Promise<string | null> => {
    console.log('[Vision Enhancement] Calling Claude API with native PDF...');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25', // Beta header for native PDF support
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 🏎️→🛵 Haiku 4.5 economico invece di Sonnet Ferrari
        max_tokens: 1024, // 🛡️ Freno di sicurezza: max 1024 token invece di 4096
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Pdf
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
    
    console.log(`[Vision Enhancement] ✓ Claude PDF extraction successful: ${extractedText?.length || 0} characters`);
    return extractedText || null;
  };

  try {
    // 🛡️ RETRY con backoff esponenziale: 3 tentativi (0s, 1s, 2s+jitter, 4s+jitter)
    const extractedText = await retryWithExponentialBackoff(
      callClaudeAPI,
      3, // maxRetries
      1000, // baseDelayMs
      'Claude PDF native extraction'
    );
    
    return extractedText;

  } catch (error) {
    console.error('[Vision Enhancement] ✗ FINAL FAILURE in enhanceWithClaudePDF:', error);
    throw error;
  }
}


// ============= FUNCTION 2C: GOOGLE VISION API CALL (FALLBACK) =============

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

// ============= HELPER: DETECT IMAGE TYPE FROM MAGIC BYTES =============

/**
 * Detects image type from magic bytes in file buffer
 * @param buffer File buffer to analyze
 * @returns Object with format ('png', 'jpeg', or 'pdf') and media_type for Claude API
 */
function detectImageType(buffer: Uint8Array): { format: string; media_type: string } {
  // PNG: magic bytes 0x89 0x50 0x4E 0x47 (89 P N G)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { format: 'png', media_type: 'image/png' };
  }
  
  // JPEG: magic bytes 0xFF 0xD8 0xFF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { format: 'jpeg', media_type: 'image/jpeg' };
  }
  
  // PDF: magic bytes %PDF (0x25 0x50 0x44 0x46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { format: 'pdf', media_type: 'application/pdf' };
  }
  
  // Default fallback (assume JPEG if unknown)
  console.warn('[detectImageType] Unknown format, defaulting to JPEG');
  return { format: 'jpeg', media_type: 'image/jpeg' };
}

// ============= FUNCTION 4: CLAUDE VISION FOR IMAGE-ONLY DOCUMENTS =============

/**
 * Analyzes image-only documents (charts, graphs) using Claude Vision to generate structured descriptions
 * Bypasses LlamaParse entirely for source_type='image' documents
 * @param pdfBuffer Raw PDF file buffer containing the image
 * @param anthropicKey Anthropic API key
 * @param fileName Document filename for logging
 */
// ============= FUNCTION 5: CONTEXT-AWARE VISUAL ENRICHMENT =============

/**
 * Genera prompt contestualizzato per Claude Vision basato sul dominio del documento
 * Replica il pattern enhanceAnalystPrompt usato per i video
 */
export function buildContextAwareVisualPrompt(
  context: any, // DocumentContext from contextAnalyzer
  elementType: string,  // 'layout_table' | 'layout_picture' | 'layout_keyValueRegion'
  pageNumber?: number  // Optional page number for RAG metadata
): string {
  
  // Base prompt per tipo elemento
  const basePrompts: Record<string, string> = {
    'layout_table': 'Analyze this TABLE.',
    'layout_picture': 'Analyze this CHART/FIGURE.',
    'layout_keyValueRegion': 'Analyze this key-value region.',
    'embedded_image': 'Analyze this embedded image.',
  };
  
  // Domain-specific enhancements (come enhanceAnalystPrompt per video)
  const domainEnhancements: Record<string, string> = {
    'trading': `
FOCUS SPECIFICO PER TRADING/FINANZA:
- Identifica OGNI candlestick pattern visibile (doji, hammer, engulfing, etc.)
- Estrai TUTTI i livelli di prezzo visibili con precisione decimale
- Documenta OGNI interazione prezzo-indicatore:
  * Timestamp/posizione nel grafico
  * Prezzo esatto al punto di contatto
  * Tipo di indicatore (SMA, EMA, Bollinger, etc.)
  * Direzione (touch from above/below)
  * Risultato (bounce, breakout, cross)
- Identifica supporti e resistenze con livelli esatti
- Nota volumi se visibili
VERBOSITÀ: MASSIMA - ogni numero conta`,

    'trading_view_pro': `
ANALISI PROFESSIONALE SCREENSHOT TRADINGVIEW:

1. LEGENDA DATI (Top-Left Corner):
   - Trascrivi ESATTAMENTE tutti i valori nei box informativi
   - Formato: "EMA 8: [valore]", "SMA 50: [valore]", "Vol: [valore]"
   - Questi sono i dati PIÙ PRECISI disponibili

2. STRUTTURA PREZZO E CANDELE:
   - Tipo candele: Verdi (Bullish) o Rosse (Bearish)
   - Ultima candela: descrivi corpo, wick superiore/inferiore
   - Pattern riconoscibili: Doji, Hammer, Engulfing, Morning Star, etc.

3. INDICATORI OVERLAY (Sul grafico principale):
   - Identifica OGNI linea colorata (Medie Mobili, Bollinger Bands)
   - Posizione rispetto al prezzo: sopra/sotto/attraversamento
   - Interazioni: touch points, crossover, supporto dinamico

4. DISEGNI UTENTE E LIVELLI:
   - Linee orizzontali: livelli di Supporto/Resistenza
   - Linee oblique: trendlines, canali
   - LEGGI I PREZZI dall'asse Y destro con precisione decimale

5. SOTTO-GRAFICI (Pannelli Inferiori):
   - Nome indicatore (RSI, MACD, OBV, Volume)
   - Trend della linea/istogramma (crescente/decrescente)
   - Livelli chiave (RSI 30/70, zero line MACD)
   - Divergenze rispetto al prezzo

6. TERMINOLOGIA OBBLIGATORIA:
   - Usa: Breakout, Divergenza, Consolidamento, Pullback
   - Specifica: Golden Cross, Death Cross se visibili
   - Pattern: Head and Shoulders, Double Top/Bottom, Triangle

OUTPUT: Markdown strutturato con TUTTI i valori numerici estratti.
PRECISIONE: Ogni numero deve essere trascritto esattamente come appare.`,

    'finance': `MODE: DENSE DATA SERIALIZATION
TARGET: Financial Reports (10-K, Balance Sheets, Income Statements)

REQUIRED OUTPUT FORMAT:
[TYPE] {Table / Chart / Text / Infographic}
[TITLE] {Exact title found in image}
[PAGE] {Use page number from METADATA below, or "unknown"}
[CONTEXT] {Time period, Currency units (e.g., $ Millions), Company Name}
[DATA]
For financial statements with multiple year columns, USE MARKDOWN TABLE FORMAT:
|                | 2017    | 2018    | YoY %   |
|----------------|---------|---------|---------|
| Revenue        | 31,657  | 32,765  | +3.5%   |

EXTRACT ALL ROWS containing numerical values.
Omit ONLY decorative separator lines or empty whitespace.
[NOTE] {Any footnotes or asterisks attached to data}
[INSIGHTS] {Max 1-2 sentences on visible trends, optional}

CONSTRAINTS:
- No conversational filler ("The table shows...", "We can observe...").
- Pure data transcription only.
- Preserve exact number formatting from source.`,

    'architecture': `
FOCUS SPECIFICO PER ARCHITETTURA:
- Identifica ogni stanza/ambiente con dimensioni
- Nota orientamento (Nord/Sud/Est/Ovest) se indicato
- Estrai quote e misure in metri/piedi
- Identifica materiali se specificati
- Nota scale, proporzioni, rapporti
VERBOSITÀ: ALTA per misure, MEDIA per descrizioni`,

    'medical': `
FOCUS SPECIFICO PER MEDICINA:
- Estrai TUTTI i valori diagnostici con unità
- Nota range di riferimento se presenti
- Identifica anomalie rispetto ai range normali
- Documenta terminologia medica esatta
VERBOSITÀ: MASSIMA - precisione critica`,

    'legal': `
FOCUS SPECIFICO PER DOCUMENTI LEGALI:
- Estrai date, numeri di protocollo, riferimenti
- Identifica parti coinvolte
- Nota clausole chiave
- Documenta firme e timbri se visibili
VERBOSITÀ: ALTA per riferimenti, MEDIA per contenuto`,

    'science': `MODE: SCIENTIFIC DATA EXTRACTION
TARGET: Research papers, scientific figures, data visualizations

REQUIRED OUTPUT FORMAT:
[TYPE] {Figure / Chart / Table / Diagram / Graph}
[TITLE] {Figure caption or title}
[PAGE] {Use page number from METADATA}
[DATA]
For quantitative data, USE MARKDOWN TABLE FORMAT:
| Variable | Value | Unit | Uncertainty |
|----------|-------|------|-------------|

EXTRACT: axis labels, data points, error bars, p-values, statistical significance markers.
[METHODOLOGY] {If visible: sample size, conditions, experimental setup}
[NOTE] {Footnotes, asterisks, significance levels (*, **, ***)}

CONSTRAINTS:
- Preserve exact numerical precision from source.
- Include units for all measurements.
- Note statistical significance markers.`,
  };
  
  const basePrompt = basePrompts[elementType] || basePrompts['layout_picture'];
  const domainEnhancement = domainEnhancements[context.domain] || '';
  
  // Costruisci prompt finale - ALL ENGLISH for RAG consistency
  return `
DOCUMENT CONTEXT: ${context.domain?.toUpperCase() || 'GENERAL'}
Expected terminology: ${context.terminology?.join(', ') || 'general'}

${basePrompt}

${domainEnhancement}

SPECIFIC ELEMENTS TO EXTRACT:
${context.focusElements?.map((e: string) => `- ${e}`).join('\n') || '- General content'}

[METADATA] Source page: ${pageNumber || 'unknown'}
`;
}

/**
 * Utility: Retry con backoff esponenziale per errori transitori
 * Riprova automaticamente su 500/502/503/429 con delay crescente
 */
async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
  context = 'operation'
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Estrai status code dall'errore
      const errorMsg = lastError.message.toLowerCase();
      const isTransientError = 
        errorMsg.includes('500') || 
        errorMsg.includes('502') || 
        errorMsg.includes('503') || 
        errorMsg.includes('429') ||
        errorMsg.includes('timeout') ||
        errorMsg.includes('network');
      
      // Se non è errore transitorio, fallisci subito
      if (!isTransientError) {
        console.error(`[Retry] Non-transient error on ${context}, failing immediately:`, lastError.message);
        throw lastError;
      }
      
      // Se è l'ultimo tentativo, fallisci
      if (attempt === maxRetries - 1) {
        console.error(`[Retry] Max retries (${maxRetries}) reached for ${context}`);
        throw lastError;
      }
      
      // Calcola delay esponenziale con jitter
      const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed for ${context}: ${lastError.message}`);
      console.warn(`[Retry] Retrying in ${Math.round(delayMs)}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError || new Error(`Retry failed after ${maxRetries} attempts`);
}

/**
 * Descrivi elemento visivo con context-awareness + RETRY AUTOMATICO
 * Usa il contesto del documento per generare prompt mirati
 * 🛡️ RESILIENZA: 3 retry automatici con backoff esponenziale su errori 500/502/503
 */
export async function describeVisualElementContextAware(
  imageBuffer: Uint8Array,
  elementType: string,
  context: any, // DocumentContext
  anthropicKey: string,
  pageNumber?: number  // Optional page number for RAG metadata
): Promise<string> {
  
  const prompt = buildContextAwareVisualPrompt(context, elementType, pageNumber);
  
  console.log(`[Visual Enrichment] Describing ${elementType} with ${context.domain} context, page: ${pageNumber || 'unknown'}`);
  
  // 🔧 FIX: Detect image format una sola volta fuori dal retry loop
  const { format, media_type } = detectImageType(imageBuffer);
  console.log(`[Visual Enrichment] Detected image format: ${format} (${media_type})`);
  
  const base64Image = encodeBase64(imageBuffer);
  
  // RAG-optimized system prompt for high-precision data extraction
  const ragSystemPrompt = `You are a High-Precision Data Extraction Engine for RAG systems.
Your output will be indexed in a vector database.
Your goal is NOT to explain the image to a human, but to TRANSCRIBE data for a machine.

RULES:
1. Absolute numerical precision (e.g., "1,234.5", not "1.2k").
2. Preservation of Structure: Use Markdown Tables for matrix data, "Key: Value" for lists.
3. Density: No fluff words. Zero hallucination.
4. If image is blurry/empty, return only: [ERROR] Unreadable`;
  
  // 🛡️ RESILIENZA: Wrapper con retry automatico
  const callClaudeAPI = async (): Promise<string> => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,  // Increased for dense data serialization
        temperature: 0.1,  // Low temperature for precision
        system: ragSystemPrompt,  // RAG-optimized system prompt
        messages: [{
          role: 'user',
          content: [
            { 
              type: 'image', 
              source: { 
                type: 'base64', 
                media_type: media_type as 'image/png' | 'image/jpeg' | 'image/webp',
                data: base64Image
              } 
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const description = result.content?.[0]?.text || '[ERROR] No description generated';
    
    console.log(`[Visual Enrichment] ✓ Description generated: ${description.length} chars`);
    return description;
  };
  
  try {
    // 🛡️ RETRY con backoff esponenziale: 3 tentativi (0s, 1s, 2s+jitter, 4s+jitter)
    const description = await retryWithExponentialBackoff(
      callClaudeAPI,
      3, // maxRetries
      1000, // baseDelayMs
      `Claude Vision for ${elementType}`
    );
    
    return description;

  } catch (error) {
    // LOGGING MIGLIORATO: specifica tipo errore e dettagli
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Visual Enrichment] ✗ FINAL FAILURE for element type ${elementType}:`, errorMsg);
    console.error(`[Visual Enrichment] Domain: ${context.domain}, Image size: ${imageBuffer.length} bytes`);
    throw error;
  }
}

// ============= FUNCTION 4: CLAUDE VISION FOR IMAGE-ONLY DOCUMENTS + RETRY =============

/**
 * Describes image-only documents using Claude Vision + RETRY AUTOMATICO
 * 🛡️ RESILIENZA: 3 retry automatici con backoff esponenziale su errori 500/502/503
 */
export async function describeImageWithClaude(
  fileBuffer: Uint8Array,
  anthropicKey: string,
  fileName: string
): Promise<string> {
  console.log(`[Image Description] Processing image document: ${fileName}`);
  console.log(`[Image Description] File buffer size: ${fileBuffer.length} bytes`);

  // Detect file format using magic bytes (una sola volta, fuori dal retry loop)
  const { format, media_type } = detectImageType(fileBuffer);
  console.log(`[Image Description] Detected format via magic bytes: ${format} (${media_type})`);
  
  const base64Data = encodeBase64(fileBuffer);
  console.log(`[Image Description] File encoded to base64: ${base64Data.length} chars`);
  
  // 🔧 SIMPLIFIED PROMPT: Reduced verbosity to prevent token explosion
  const structuredPrompt = `Describe this chart/graph concisely in Markdown format.

Include:
- Chart type
- Key data points (top 5-10 values)
- Main trend or pattern

Keep the description brief and factual. Use tables for numerical data when appropriate.`;

  console.log(`[Image Description] Calling Claude API with ${format === 'pdf' ? 'native PDF' : `${format.toUpperCase()} image`}...`);
  
  // Build content array based on file format (una volta, fuori dal retry)
  const content = format === 'pdf'
    ? [
        {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: base64Data
          }
        },
        {
          type: 'text' as const,
          text: structuredPrompt
        }
      ]
    : [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: media_type as 'image/png' | 'image/jpeg',
            data: base64Data
          }
        },
        {
          type: 'text' as const,
          text: structuredPrompt
        }
      ];
  
  // Build headers (beta header only for PDF, una volta fuori dal retry)
  const headers: Record<string, string> = {
    'x-api-key': anthropicKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  };
  
  if (format === 'pdf') {
    headers['anthropic-beta'] = 'pdfs-2024-09-25'; // Native PDF support (not needed for images)
  }
  
  // 🛡️ RESILIENZA: Wrapper con retry automatico
  const callClaudeAPI = async (): Promise<string> => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 🏎️→🛵 Haiku 4.5 economico invece di Sonnet Ferrari
        max_tokens: 1024, // 🛡️ Freno di sicurezza: max 1024 token invece di 2048
        messages: [{
          role: 'user',
          content
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Image Description] Claude API error ${response.status}:`, errorText);
      throw new Error(`Claude API failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const description = result.content?.[0]?.text;
    
    if (!description) {
      throw new Error('Claude returned empty description');
    }

    console.log(`[Image Description] ✓ Claude description successful: ${description.length} characters`);
    return description;
  };

  try {
    // 🛡️ RETRY con backoff esponenziale: 3 tentativi (0s, 1s, 2s+jitter, 4s+jitter)
    const description = await retryWithExponentialBackoff(
      callClaudeAPI,
      3, // maxRetries
      1000, // baseDelayMs
      `Claude Image Description for ${fileName}`
    );
    
    return description;

  } catch (error) {
    console.error('[Image Description] ✗ FINAL FAILURE in describeImageWithClaude:', error);
    throw error;
  }
}
