/**
 * PDF Text Extraction for Pipeline C
 * Utilizza pdfjs-dist per estrarre testo strutturato da PDF
 */

interface PDFPage {
  pageNumber: number;
  text: string;
  items: Array<{
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

interface PDFExtractionResult {
  pages: PDFPage[];
  metadata: {
    pageCount: number;
    title?: string;
    author?: string;
    subject?: string;
    creationDate?: string;
  };
  fullText: string;
}

/**
 * Estrae testo raw da un PDF buffer usando parsing diretto
 * Compatibile con Deno - non richiede API browser
 * 
 * @param pdfBuffer - ArrayBuffer del PDF
 * @returns Risultato estrazione con testo completo e metadata base
 */
export async function extractTextFromPDF(
  pdfBuffer: ArrayBuffer
): Promise<PDFExtractionResult> {
  try {
    // Converti ArrayBuffer a Uint8Array
    const uint8Array = new Uint8Array(pdfBuffer);
    
    // Converti a stringa per l'analisi
    const decoder = new TextDecoder('latin1');
    const pdfText = decoder.decode(uint8Array);
    
    // Estrai testo usando regex per trovare stream di testo PDF
    const textMatches = pdfText.matchAll(/BT\s+(.*?)\s+ET/gs);
    const extractedTexts: string[] = [];
    
    for (const match of textMatches) {
      const textBlock = match[1];
      
      // Estrai stringhe tra parentesi (contenuto testuale PDF)
      const strings = textBlock.matchAll(/\(((?:[^()\\]|\\.)*)\)/g);
      for (const strMatch of strings) {
        let text = strMatch[1];
        
        // Decodifica escape sequences
        text = text
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\');
        
        if (text.trim()) {
          extractedTexts.push(text.trim());
        }
      }
    }
    
    const fullText = extractedTexts.join(' ').replace(/\s+/g, ' ').trim();
    
    // Conta pagine approssimativo
    const pageMatches = pdfText.match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pageMatches ? pageMatches.length : 1;
    
    // Estrai metadata base
    const titleMatch = pdfText.match(/\/Title\s*\(([^)]+)\)/);
    const authorMatch = pdfText.match(/\/Author\s*\(([^)]+)\)/);
    const subjectMatch = pdfText.match(/\/Subject\s*\(([^)]+)\)/);
    
    return {
      pages: [{
        pageNumber: 1,
        text: fullText,
        items: []
      }],
      metadata: {
        pageCount,
        title: titleMatch?.[1],
        author: authorMatch?.[1],
        subject: subjectMatch?.[1],
      },
      fullText,
    };
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Estrae testo da una pagina specifica
 */
export async function extractPageText(
  pdfBuffer: ArrayBuffer,
  pageNumber: number
): Promise<string> {
  const result = await extractTextFromPDF(pdfBuffer);
  const page = result.pages.find(p => p.pageNumber === pageNumber);
  
  if (!page) {
    throw new Error(`Page ${pageNumber} not found in PDF`);
  }
  
  return page.text;
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
