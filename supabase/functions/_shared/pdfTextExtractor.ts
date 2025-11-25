/**
 * PDF Text Extraction for Pipeline C using Landing AI
 * Uses Landing AI for robust PDF text extraction, then applies custom chunking
 * This hybrid approach leverages Landing AI's strength (PDF parsing) while 
 * maintaining Pipeline C's custom semantic chunking
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

/**
 * Estrae testo da PDF usando Landing AI, ritorna fullText per chunking custom
 * 
 * @param pdfBuffer - ArrayBuffer del PDF
 * @returns Risultato con fullText estratto da Landing AI
 */
export async function extractTextFromPDF(
  pdfBuffer: ArrayBuffer
): Promise<PDFExtractionResult> {
  const landingApiKey = Deno.env.get('LANDING_AI_API_KEY');
  
  if (!landingApiKey) {
    throw new Error('LANDING_AI_API_KEY not configured');
  }

  try {
    // 1. Invia PDF a Landing AI per parsing
    console.log(`[PDF Extractor] Sending PDF to Landing AI for text extraction`);
    
    const formData = new FormData();
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    formData.append('file', blob, 'document.pdf');

    const parseResponse = await fetch('https://api.landing.ai/v1/ade/parse', {
      method: 'POST',
      headers: {
        'apikey': landingApiKey,
      },
      body: formData,
    });

    if (!parseResponse.ok) {
      const errorText = await parseResponse.text();
      throw new Error(`Landing AI parse failed (${parseResponse.status}): ${errorText}`);
    }

    const parseResult = await parseResponse.json();
    const jobId = parseResult.job_id;

    if (!jobId) {
      throw new Error('Landing AI did not return job_id');
    }

    console.log(`[PDF Extractor] Landing AI job created: ${jobId}`);

    // 2. Poll per completion
    let attempts = 0;
    const maxAttempts = 60; // 5 min max
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay
      attempts++;

      const statusResponse = await fetch(
        `https://api.landing.ai/v1/ade/parse/jobs/${jobId}`,
        {
          headers: { 'apikey': landingApiKey },
        }
      );

      if (!statusResponse.ok) {
        console.warn(`[PDF Extractor] Poll attempt ${attempts} failed`);
        continue;
      }

      const jobData = await statusResponse.json();
      const status = jobData.status;

      console.log(`[PDF Extractor] Job status: ${status} (attempt ${attempts}/${maxAttempts})`);

      if (status === 'completed') {
        // 3. Estrai chunks da Landing AI
        const chunks = jobData.chunks || [];
        
        if (chunks.length === 0) {
          throw new Error('Landing AI returned 0 chunks - PDF may be image-only or empty');
        }

        // 4. Combina tutto il testo dei chunks in fullText
        const fullText = chunks
          .map((chunk: any) => chunk.markdown || chunk.text || '')
          .filter((text: string) => text.trim().length > 0)
          .join('\n\n');

        console.log(`[PDF Extractor] ✅ Extracted ${fullText.length} chars from Landing AI (${chunks.length} raw chunks)`);

        // 5. Estrai metadata
        const pageCount = Math.max(...chunks.map((c: any) => c.grounding?.page || 1).filter(Boolean));

        return {
          pages: [{
            pageNumber: 1,
            text: fullText,
            items: []
          }],
          metadata: {
            pageCount: pageCount || 1,
          },
          fullText,
        };
      } else if (status === 'failed') {
        throw new Error(`Landing AI job failed: ${jobData.error_message || 'Unknown error'}`);
      }
    }

    throw new Error('Landing AI job timeout after 5 minutes');

  } catch (error) {
    console.error('[PDF Extractor] Extraction failed:', error);
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
