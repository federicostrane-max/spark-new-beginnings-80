import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker - using jsDelivr CDN for better reliability
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Extract text from a PDF file
 * @param file - PDF file to extract text from
 * @returns Extracted text content
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    // Convert file to array buffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Load PDF document
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // Combine text items with spaces
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      
      fullText += pageText + '\n\n';
    }
    
    return fullText.trim();
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error(`Failed to extract text from ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate PDF file
 * @param file - File to validate
 * @param maxSizeMB - Maximum file size in MB (default: 10MB)
 * @returns Validation result
 */
export function validatePDFFile(file: File, maxSizeMB: number = 10): { valid: boolean; error?: string } {
  // Check file type
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return { valid: false, error: 'File must be a PDF' };
  }
  
  // Check file size
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
  }
  
  return { valid: true };
}
