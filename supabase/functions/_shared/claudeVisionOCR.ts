/**
 * Claude Vision Direct OCR Pipeline
 * 
 * Alternative pipeline for scanned PDFs when LlamaParse fails.
 * Uses Claude Vision API directly to extract text from PDF pages.
 * 
 * Architecture:
 * 1. Download PDF from storage
 * 2. Send PDF to Claude Vision (native PDF support)
 * 3. Extract structured text
 * 4. Return text for chunking
 */

import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";

// ============= INTERFACES =============

export interface ClaudeOCRResult {
  success: boolean;
  text: string;
  pageCount: number;
  processingTimeMs: number;
  errorMessage?: string;
}

export interface ClaudeOCROptions {
  anthropicKey: string;
  fileName: string;
  maxRetries?: number;
}

// ============= CONSTANTS =============

const MAX_PDF_SIZE_MB = 32; // Claude's max PDF size per request
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'; // Cost-effective for OCR
const MAX_TOKENS = 8192; // Sufficient for most pages
const MAX_PAGES_PER_REQUEST = 100; // Claude's limit per PDF request

// ============= RETRY UTILITY =============

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
  context: string = 'operation'
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if retryable (5xx, 429, timeout)
      const isRetryable = 
        lastError.message.includes('500') ||
        lastError.message.includes('502') ||
        lastError.message.includes('503') ||
        lastError.message.includes('429') ||
        lastError.message.includes('timeout');
      
      if (!isRetryable || attempt === maxRetries) {
        console.error(`[ClaudeOCR] ${context} failed after ${attempt + 1} attempts:`, lastError.message);
        throw lastError;
      }
      
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      console.log(`[ClaudeOCR] ${context} attempt ${attempt + 1} failed, retrying in ${delay.toFixed(0)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// ============= MAIN OCR FUNCTION =============

/**
 * Extract text from a PDF using Claude Vision's native PDF support
 * 
 * @param pdfBuffer - Raw PDF file buffer
 * @param options - OCR options including API key
 * @returns OCR result with extracted text
 */
export async function extractTextWithClaudeVision(
  pdfBuffer: Uint8Array,
  options: ClaudeOCROptions
): Promise<ClaudeOCRResult> {
  const startTime = Date.now();
  const { anthropicKey, fileName, maxRetries = 3 } = options;
  
  console.log(`[ClaudeOCR] Starting OCR for "${fileName}" (${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  
  // Size check
  const sizeMB = pdfBuffer.length / 1024 / 1024;
  if (sizeMB > MAX_PDF_SIZE_MB) {
    return {
      success: false,
      text: '',
      pageCount: 0,
      processingTimeMs: Date.now() - startTime,
      errorMessage: `PDF too large: ${sizeMB.toFixed(2)}MB exceeds ${MAX_PDF_SIZE_MB}MB limit`
    };
  }
  
  // Count pages in PDF to determine if pagination needed
  const totalPages = countPdfPages(pdfBuffer);
  console.log(`[ClaudeOCR] Detected ${totalPages} pages in PDF`);
  
  // If more than 100 pages, use paginated processing
  if (totalPages > MAX_PAGES_PER_REQUEST) {
    console.log(`[ClaudeOCR] PDF exceeds ${MAX_PAGES_PER_REQUEST} pages, using paginated processing`);
    return await extractTextPaginated(pdfBuffer, totalPages, options);
  }
  
  // Standard single-request processing for ≤100 pages
  return await extractTextSingleRequest(pdfBuffer, options);
}

/**
 * Count pages in PDF by parsing the PDF structure
 * Uses a simple heuristic: count "/Type /Page" occurrences
 */
function countPdfPages(pdfBuffer: Uint8Array): number {
  try {
    // Convert to string for pattern matching (works for PDF structure)
    const decoder = new TextDecoder('latin1');
    const pdfText = decoder.decode(pdfBuffer);
    
    // Method 1: Look for /Count in page tree
    const countMatch = pdfText.match(/\/Count\s+(\d+)/);
    if (countMatch) {
      const count = parseInt(countMatch[1], 10);
      if (count > 0 && count < 10000) {
        return count;
      }
    }
    
    // Method 2: Count /Type /Page occurrences (excluding /Pages)
    const pageMatches = pdfText.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) {
      return pageMatches.length;
    }
    
    // Fallback: estimate from file size (rough: ~50KB per page for scanned docs)
    return Math.max(1, Math.ceil(pdfBuffer.length / (50 * 1024)));
  } catch (error) {
    console.warn('[ClaudeOCR] Error counting pages, using estimate:', error);
    return Math.max(1, Math.ceil(pdfBuffer.length / (50 * 1024)));
  }
}

/**
 * For PDFs > 100 pages, Claude doesn't support page_range parameter directly.
 * We'll process the whole PDF in a single request with truncation handling.
 * 
 * Note: This is a limitation - for very large PDFs, consider splitting at storage level.
 */
async function extractTextPaginated(
  pdfBuffer: Uint8Array,
  totalPages: number,
  options: ClaudeOCROptions
): Promise<ClaudeOCRResult> {
  const startTime = Date.now();
  const { fileName } = options;
  
  // For PDFs > 100 pages, Claude API doesn't support page_range.
  // We'll attempt to process the whole PDF - Claude will process what it can.
  console.log(`[ClaudeOCR] Large PDF (${totalPages} pages) - processing entire document (may be truncated)`);
  
  // Just use single request processing - Claude will handle what it can
  const result = await extractTextSingleRequest(pdfBuffer, options);
  
  // Adjust the page count in the result
  if (result.success) {
    console.log(`[ClaudeOCR] ✅ Large PDF processed: ${result.text.length} chars (some pages may be truncated)`);
    result.pageCount = totalPages;
  }
  
  return result;
}

/**
 * Extract text in a single request for PDFs ≤ 100 pages
 */
async function extractTextSingleRequest(
  pdfBuffer: Uint8Array,
  options: ClaudeOCROptions
): Promise<ClaudeOCRResult> {
  const startTime = Date.now();
  const { anthropicKey, fileName, maxRetries = 3 } = options;
  
  const base64Pdf = encodeBase64(pdfBuffer);
  console.log(`[ClaudeOCR] Encoded PDF to base64: ${(base64Pdf.length / 1024).toFixed(0)} KB`);

  try {
    const extractedText = await retryWithBackoff(
      async () => {
        console.log(`[ClaudeOCR] Calling Claude Vision API...`);
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: MAX_TOKENS,
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
                  text: getOCRPrompt(true, 1, 0, 0)
                }
              ]
            }]
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Claude API error ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        return result.content?.[0]?.text || '';
      },
      maxRetries,
      1000,
      `Claude OCR for ${fileName}`
    );
    
    // Estimate page count from page breaks or content length
    const pageBreaks = (extractedText.match(/---/g) || []).length;
    const estimatedPages = pageBreaks > 0 ? pageBreaks + 1 : Math.ceil(extractedText.length / 3000);
    
    console.log(`[ClaudeOCR] ✅ Success: ${extractedText.length} chars, ~${estimatedPages} pages`);
    
    return {
      success: true,
      text: extractedText,
      pageCount: estimatedPages,
      processingTimeMs: Date.now() - startTime
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ClaudeOCR] ❌ Failed for "${fileName}":`, errorMessage);
    
    return {
      success: false,
      text: '',
      pageCount: 0,
      processingTimeMs: Date.now() - startTime,
      errorMessage
    };
  }
}

/**
 * Generate context-aware OCR prompt
 */
function getOCRPrompt(isFirstBatch: boolean, startPage: number, endPage: number, totalPages: number): string {
  const pageContext = totalPages > 0 
    ? `\n\nNote: Processing pages ${startPage}-${endPage} of ${totalPages} total pages.`
    : '';
  
  const continuationNote = !isFirstBatch
    ? '\n\nThis is a continuation from previous pages. Continue transcribing without repeating content.'
    : '';
  
  return `You are an expert OCR system. Extract ALL text from this scanned PDF document with maximum accuracy.

CRITICAL INSTRUCTIONS:
1. Transcribe EVERY piece of visible text, including:
   - Headers, footers, page numbers
   - Tables (preserve structure using markdown tables)
   - Handwritten annotations if legible
   - Watermarks and stamps
   - Dates, numbers, codes

2. PRESERVE document structure:
   - Use ## for section headers
   - Use markdown tables for tabular data
   - Use --- for page breaks
   - Maintain paragraph spacing

3. HANDLE OCR CHALLENGES:
   - For ambiguous characters, use context to infer (e.g., "0" vs "O", "1" vs "l")
   - For dates, look for other dates in document to infer year format
   - If text is truly illegible, mark as [illegible]

4. OUTPUT FORMAT:
   - Pure text/markdown only
   - No JSON or structured format
   - No commentary like "This document contains..."
${pageContext}${continuationNote}

Begin transcription:`;
}

// ============= CHUNKING HELPER =============

/**
 * Chunk OCR output into semantic units for embedding
 * Uses simple paragraph-based chunking with overlap
 */
export function chunkOCROutput(
  text: string,
  options: {
    maxChunkSize?: number;
    overlapSize?: number;
  } = {}
): { content: string; chunkIndex: number }[] {
  const { maxChunkSize = 1500, overlapSize = 200 } = options;
  
  // Split by double newlines (paragraphs) or page breaks
  const paragraphs = text.split(/\n\n+|---\n*/);
  
  const chunks: { content: string; chunkIndex: number }[] = [];
  let currentChunk = '';
  let chunkIndex = 0;
  
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    
    // If adding this paragraph exceeds max size, save current chunk
    if (currentChunk.length + trimmed.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++
      });
      
      // Keep overlap from end of current chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlapSize / 5)); // ~5 chars per word
      currentChunk = overlapWords.join(' ') + '\n\n' + trimmed;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      chunkIndex: chunkIndex
    });
  }
  
  console.log(`[ClaudeOCR] Chunked into ${chunks.length} segments`);
  return chunks;
}
