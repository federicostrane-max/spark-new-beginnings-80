/**
 * PDF Text Extraction for Pipeline C - INDEPENDENT SYSTEM
 * Uses native regex extraction with OCR fallback via Lovable AI Gateway
 * NO DEPENDENCIES on Landing AI or external parsing services
 */

interface PDFExtractionResult {
  pages: Array<{
    pageNumber: number;
    text: string;
    items: any[];
  }>;
  metadata: {
    pageCount: number;
    title?: string;
    author?: string;
    subject?: string;
    creationDate?: string;
  };
  fullText: string;
}

interface OCRFallbackOptions {
  supabase: any;
  bucket: string;
  path: string;
}

/**
 * Extract text from PDF using native regex extraction
 * This works for PDFs with embedded text (not scanned images)
 */
async function extractTextNatively(pdfBuffer: ArrayBuffer): Promise<string> {
  try {
    console.log('[PDF Extractor] Attempting native text extraction...');
    
    // Convert ArrayBuffer to string to look for text content
    const uint8Array = new Uint8Array(pdfBuffer);
    const decoder = new TextDecoder('latin1'); // PDFs use latin1 encoding
    const pdfString = decoder.decode(uint8Array);
    
    // Extract text between stream objects (simple PDF text extraction)
    const textMatches = pdfString.match(/\(([^)]+)\)/g) || [];
    
    let extractedText = '';
    for (const match of textMatches) {
      // Remove parentheses and clean up
      const text = match.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
        .replace(/\\([()])/g, '$1');
      
      // Filter out control characters and keep meaningful text
      if (text.length > 2 && !/^[\x00-\x1F]+$/.test(text)) {
        extractedText += text + ' ';
      }
    }
    
    // Also try to extract text from BT/ET blocks (more sophisticated)
    const btEtPattern = /BT\s*(.*?)\s*ET/gs;
    const btEtMatches = pdfString.match(btEtPattern) || [];
    
    for (const block of btEtMatches) {
      const tjMatches = block.match(/\[(.*?)\]\s*TJ/g) || [];
      for (const tj of tjMatches) {
        const content = tj.match(/\(([^)]+)\)/g) || [];
        for (const c of content) {
          const cleaned = c.slice(1, -1);
          if (cleaned.length > 1) {
            extractedText += cleaned + ' ';
          }
        }
      }
    }
    
    const finalText = extractedText.trim();
    console.log(`[PDF Extractor] Native extraction: ${finalText.length} characters`);
    
    return finalText;
  } catch (error) {
    console.error('[PDF Extractor] Native extraction failed:', error);
    return '';
  }
}

/**
 * Estimate page count from PDF buffer
 */
function estimatePageCount(pdfBuffer: ArrayBuffer): number {
  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    const decoder = new TextDecoder('latin1');
    const pdfString = decoder.decode(uint8Array);
    
    // Look for /Count entry in Pages object
    const countMatch = pdfString.match(/\/Type\s*\/Pages.*?\/Count\s+(\d+)/s);
    if (countMatch) {
      return parseInt(countMatch[1], 10);
    }
    
    // Fallback: count /Page entries
    const pageMatches = pdfString.match(/\/Type\s*\/Page[^s]/g);
    return pageMatches ? pageMatches.length : 1;
  } catch {
    return 1;
  }
}

/**
 * Verifica se il testo estratto è corrotto (caratteri Unicode invalidi, encoding errato, struttura PDF raw)
 */
function isTextCorrupted(text: string): boolean {
  if (!text || text.length === 0) return true;
  
  // 1. Check per struttura PDF raw (indica parsing sbagliato - CRITICAL)
  const pdfStructurePatterns = [
    /endobj/,
    /\/Type\s*\/Page/,
    /stream\s*$/m,
    /<</,
    /\/FlateDecode/,
    /\/Filter/,
    /\/Font/,
    /\/XObject/
  ];
  
  for (const pattern of pdfStructurePatterns) {
    if (pattern.test(text)) {
      console.log('[PDF Extractor] Corruption: PDF structure detected in text');
      return true;
    }
  }
  
  // 2. Check per alta concentrazione Latin-1 Supplement (0x80-0xFF) - dove finiscono i dati binari
  let latin1ExtendedCount = 0;
  let printableAsciiCount = 0;
  
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x80 && code <= 0xFF) latin1ExtendedCount++;
    if (code >= 0x20 && code <= 0x7E) printableAsciiCount++;
  }
  
  const latin1Ratio = latin1ExtendedCount / text.length;
  if (latin1Ratio > 0.15) { // Più del 15% Latin-1 Extended = binario corrotto
    console.log(`[PDF Extractor] Corruption: ${(latin1Ratio * 100).toFixed(1)}% Latin-1 Extended chars (binary data)`);
    return true;
  }
  
  // 3. Check per assenza di parole riconoscibili (solo per testi > 500 chars)
  if (text.length > 500) {
    const wordPattern = /[a-zA-Z]{3,}/g;
    const words = text.match(wordPattern) || [];
    const wordRatio = words.join('').length / text.length;
    
    if (wordRatio < 0.1) { // Meno del 10% parole = non è testo leggibile
      console.log(`[PDF Extractor] Corruption: only ${(wordRatio * 100).toFixed(1)}% readable words`);
      return true;
    }
  }
  
  // 4. Original checks per caratteri control e Unicode invalidi
  let corruptedChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) || // Control chars
      (code >= 0x007F && code <= 0x009F) || // More control chars
      code === 0xFFFD || // Replacement character
      (code >= 0xE000 && code <= 0xF8FF) || // Private use area
      (code >= 0xF0000 && code <= 0xFFFFD) || // Supplementary private use
      (code >= 0x100000 && code <= 0x10FFFD) // More private use
    ) {
      corruptedChars++;
    }
  }
  
  const corruptionRatio = corruptedChars / text.length;
  if (corruptionRatio > 0.3) {
    console.log(`[PDF Extractor] Corruption: ${(corruptionRatio * 100).toFixed(1)}% invalid Unicode chars`);
    return true;
  }
  
  return false;
}

/**
 * Estrae testo da PDF usando estrazione nativa + fallback OCR via Lovable AI Gateway
 * 
 * @param pdfBuffer - ArrayBuffer del PDF
 * @param ocrOptions - Opzioni per OCR fallback (supabase, bucket, path)
 * @returns Risultato con fullText estratto
 */
export async function extractTextFromPDF(
  pdfBuffer: ArrayBuffer,
  ocrOptions?: OCRFallbackOptions
): Promise<PDFExtractionResult> {
  try {
    // PHASE 1: Try native extraction first
    console.log('[PDF Extractor] PHASE 1: Native extraction...');
    const nativeText = await extractTextNatively(pdfBuffer);
    const pageCount = estimatePageCount(pdfBuffer);
    
    let finalText = nativeText;
    
    // PHASE 2: OCR fallback if native extraction insufficient OR corrupted
    const isInsufficient = nativeText.length < 100;
    const isCorrupted = isTextCorrupted(nativeText);
    
    if ((isInsufficient || isCorrupted) && ocrOptions) {
      const reason = isInsufficient 
        ? `insufficient (${nativeText.length} chars)` 
        : 'corrupted encoding';
      
      console.log(`[PDF Extractor] Native extraction ${reason}, trying OCR fallback...`);
      
      try {
        // Create signed URL for OCR service
        const { data: signedUrlData, error: signedUrlError } = await ocrOptions.supabase
          .storage
          .from(ocrOptions.bucket)
          .createSignedUrl(ocrOptions.path, 300); // 5 minutes

        if (signedUrlError || !signedUrlData?.signedUrl) {
          console.warn('[PDF Extractor] Failed to create signed URL for OCR:', signedUrlError);
        } else {
          console.log('[PDF Extractor] PHASE 2: Calling ocr-image for OCR fallback...');
          
          const { data: ocrData, error: ocrError } = await ocrOptions.supabase.functions.invoke('ocr-image', {
            body: {
              imageUrl: signedUrlData.signedUrl,
              fileName: ocrOptions.path.split('/').pop() || 'document.pdf',
              maxPages: Math.min(pageCount, 5) // Max 5 pages for OCR
            }
          });

          if (ocrError) {
            console.warn('[PDF Extractor] OCR fallback failed:', ocrError);
          } else {
            finalText = ocrData?.extractedText || nativeText;
            console.log(`[PDF Extractor] ✅ OCR extraction: ${finalText.length} characters`);
          }
        }
      } catch (ocrErr) {
        console.warn('[PDF Extractor] OCR fallback error:', ocrErr);
        // Continue with native text
      }
    }

    console.log(`[PDF Extractor] ✅ Final extraction: ${finalText.length} characters (${pageCount} pages)`);

    return {
      pages: [{
        pageNumber: 1,
        text: finalText,
        items: []
      }],
      metadata: {
        pageCount,
      },
      fullText: finalText,
    };

  } catch (error) {
    console.error('[PDF Extractor] Extraction failed:', error);
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Valida che un buffer sia un PDF valido
 */
export function isPDFBuffer(buffer: ArrayBuffer): boolean {
  const arr = new Uint8Array(buffer);
  // PDF magic number: %PDF-
  return arr.length > 4 &&
    arr[0] === 0x25 && // %
    arr[1] === 0x50 && // P
    arr[2] === 0x44 && // D
    arr[3] === 0x46;   // F
}
