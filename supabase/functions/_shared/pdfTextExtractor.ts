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
 * Estrae testo strutturato da un PDF buffer
 * Usa pdfjs-dist già installato nel progetto
 * 
 * @param pdfBuffer - ArrayBuffer del PDF
 * @returns Risultato estrazione con pagine, metadata e testo completo
 */
export async function extractTextFromPDF(
  pdfBuffer: ArrayBuffer
): Promise<PDFExtractionResult> {
  // Import pdfjs-dist locale (già installato via npm)
  const pdfjsLib = await import('pdfjs-dist');
  
  // Configura worker path
  // @ts-ignore - GlobalWorkerOptions exists at runtime
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  
  try {
    // Carica documento PDF
    // @ts-ignore - getDocument exists at runtime
    const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
    const pdf = await loadingTask.promise;
    
    const pages: PDFPage[] = [];
    let fullText = '';
    
    // Estrai testo da ogni pagina
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Estrai items con posizioni
      const items = textContent.items.map((item: any) => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      }));
      
      // Combina testo della pagina
      const pageText = items
        .map((item: { str: string }) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      pages.push({
        pageNumber: pageNum,
        text: pageText,
        items,
      });
      
      fullText += pageText + '\n\n';
    }
    
    // Estrai metadata PDF
    const metadata = await pdf.getMetadata();
    const info = metadata.info as any; // Type assertion per metadata PDF
    
    return {
      pages,
      metadata: {
        pageCount: pdf.numPages,
        title: info?.Title,
        author: info?.Author,
        subject: info?.Subject,
        creationDate: info?.CreationDate,
      },
      fullText: fullText.trim(),
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
