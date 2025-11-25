/**
 * PDF Text Extraction for Pipeline C - SIMPLIFIED SYSTEM
 * Uses Google Cloud Vision API for ALL PDF text extraction
 * NO native regex parsing or corruption detection logic
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

interface ExtractionOptions {
  googleCloudVisionApiKey: string;
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
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
 * Estrae testo da PDF usando SOLO Google Cloud Vision API
 * Nessun parsing nativo, nessun fallback, nessuna logica di corruzione
 * 
 * @param pdfBuffer - ArrayBuffer del PDF
 * @param options - Opzioni con chiave API Google Cloud Vision
 * @returns Risultato con fullText estratto
 */
export async function extractTextFromPDF(
  pdfBuffer: ArrayBuffer,
  options: ExtractionOptions
): Promise<PDFExtractionResult> {
  try {
    console.log('[PDF Extractor] Using Google Cloud Vision for PDF text extraction');
    
    // Convert PDF to base64
    const base64PDF = arrayBufferToBase64(pdfBuffer);
    const pageCount = estimatePageCount(pdfBuffer);
    
    console.log(`[PDF Extractor] Sending ${(pdfBuffer.byteLength / 1024).toFixed(2)}KB PDF to Google Cloud Vision (estimated ${pageCount} pages)`);

    // Call Google Cloud Vision API
    const response = await fetch(
      `https://vision.googleapis.com/v1/files:annotate?key=${options.googleCloudVisionApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              inputConfig: {
                content: base64PDF,
                mimeType: 'application/pdf',
              },
              features: [
                {
                  type: 'DOCUMENT_TEXT_DETECTION',
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Cloud Vision API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Extract text from all pages
    const responses = result.responses?.[0]?.responses || [];
    const extractedTexts = responses
      .map((r: any) => r.fullTextAnnotation?.text || '')
      .filter((text: string) => text.length > 0);

    const fullText = extractedTexts.join('\n\n');
    
    console.log(`[PDF Extractor] ✅ Google Cloud Vision extracted ${fullText.length} characters from ${responses.length} pages`);

    if (fullText.length === 0) {
      throw new Error('Google Cloud Vision returned 0 characters - PDF may be empty or corrupted');
    }

    return {
      pages: [{
        pageNumber: 1,
        text: fullText,
        items: []
      }],
      metadata: {
        pageCount: responses.length || pageCount,
      },
      fullText,
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
