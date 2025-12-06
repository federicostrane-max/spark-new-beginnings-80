/**
 * Claude Vision Direct OCR Pipeline
 * 
 * Alternative pipeline for scanned PDFs when LlamaParse fails.
 * Uses Claude Vision API directly to extract text from PDF pages.
 * 
 * Architecture:
 * 1. Download PDF from storage
 * 2. For PDFs > 100 pages: split into 100-page chunks using pdf-lib
 * 3. Send each chunk to Claude Vision (native PDF support)
 * 4. Combine extracted text from all chunks
 * 5. Return text for chunking
 */

import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

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
const MAX_PAGES_PER_CHUNK = 100; // Claude's limit per PDF request
const DELAY_BETWEEN_CHUNKS_MS = 1000; // Rate limiting protection

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

// ============= PDF SPLITTING UTILITY =============

/**
 * Split a PDF into chunks of maxPages pages each using pdf-lib
 * Returns array of PDF buffers
 */
async function splitPdfIntoChunks(
  pdfBuffer: Uint8Array,
  maxPages: number = MAX_PAGES_PER_CHUNK
): Promise<{ chunk: Uint8Array; startPage: number; endPage: number }[]> {
  console.log(`[ClaudeOCR] Loading PDF with pdf-lib for splitting...`);
  
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  
  console.log(`[ClaudeOCR] PDF has ${totalPages} pages, splitting into ${Math.ceil(totalPages / maxPages)} chunks`);
  
  const chunks: { chunk: Uint8Array; startPage: number; endPage: number }[] = [];
  
  for (let startPage = 0; startPage < totalPages; startPage += maxPages) {
    const endPage = Math.min(startPage + maxPages - 1, totalPages - 1);
    const pageCount = endPage - startPage + 1;
    
    console.log(`[ClaudeOCR] Creating chunk: pages ${startPage + 1}-${endPage + 1} (${pageCount} pages)`);
    
    // Create new PDF with just these pages
    const newPdfDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: pageCount }, (_, i) => startPage + i);
    const copiedPages = await newPdfDoc.copyPages(pdfDoc, pageIndices);
    
    for (const page of copiedPages) {
      newPdfDoc.addPage(page);
    }
    
    const chunkBytes = await newPdfDoc.save();
    chunks.push({
      chunk: new Uint8Array(chunkBytes),
      startPage: startPage + 1, // 1-indexed for logging
      endPage: endPage + 1
    });
    
    console.log(`[ClaudeOCR] Chunk created: ${(chunkBytes.length / 1024 / 1024).toFixed(2)} MB`);
  }
  
  return chunks;
}

// ============= MAIN OCR FUNCTION =============

/**
 * Extract text from a PDF using Claude Vision's native PDF support
 * 
 * For PDFs > 100 pages: splits into 100-page chunks using pdf-lib,
 * processes each chunk separately, and combines results.
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
  
  try {
    // Load PDF with pdf-lib to get accurate page count
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();
    console.log(`[ClaudeOCR] PDF has ${totalPages} pages (pdf-lib count)`);
    
    // If ≤ 100 pages, process directly
    if (totalPages <= MAX_PAGES_PER_CHUNK) {
      console.log(`[ClaudeOCR] PDF within limit, processing directly`);
      return await extractTextSingleRequest(pdfBuffer, totalPages, options);
    }
    
    // For > 100 pages: split and process each chunk
    console.log(`[ClaudeOCR] PDF exceeds ${MAX_PAGES_PER_CHUNK} pages, using pdf-lib splitting`);
    return await extractTextWithSplitting(pdfBuffer, totalPages, options);
    
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
 * Process large PDF by splitting into chunks with pdf-lib
 */
async function extractTextWithSplitting(
  pdfBuffer: Uint8Array,
  totalPages: number,
  options: ClaudeOCROptions
): Promise<ClaudeOCRResult> {
  const startTime = Date.now();
  const { fileName } = options;
  
  // Split PDF into 100-page chunks
  const chunks = await splitPdfIntoChunks(pdfBuffer, MAX_PAGES_PER_CHUNK);
  console.log(`[ClaudeOCR] Split into ${chunks.length} chunks for processing`);
  
  const allTexts: string[] = [];
  let successfulChunks = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    const { chunk, startPage, endPage } = chunks[i];
    console.log(`[ClaudeOCR] Processing chunk ${i + 1}/${chunks.length} (pages ${startPage}-${endPage})`);
    
    const chunkResult = await extractTextSingleRequest(
      chunk, 
      endPage - startPage + 1, 
      {
        ...options,
        fileName: `${fileName} [pages ${startPage}-${endPage}]`
      },
      i === 0, // isFirstBatch
      startPage,
      endPage,
      totalPages
    );
    
    if (chunkResult.success && chunkResult.text) {
      allTexts.push(`\n\n--- PAGES ${startPage}-${endPage} ---\n\n${chunkResult.text}`);
      successfulChunks++;
    } else {
      console.warn(`[ClaudeOCR] Chunk ${i + 1} failed: ${chunkResult.errorMessage}`);
      allTexts.push(`\n\n--- PAGES ${startPage}-${endPage} [OCR FAILED] ---\n\n`);
    }
    
    // Rate limiting delay between chunks
    if (i < chunks.length - 1) {
      console.log(`[ClaudeOCR] Waiting ${DELAY_BETWEEN_CHUNKS_MS}ms before next chunk...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS_MS));
    }
  }
  
  const combinedText = allTexts.join('');
  const success = successfulChunks > 0;
  
  console.log(`[ClaudeOCR] ✅ Completed: ${successfulChunks}/${chunks.length} chunks successful, ${combinedText.length} total chars`);
  
  return {
    success,
    text: combinedText,
    pageCount: totalPages,
    processingTimeMs: Date.now() - startTime,
    errorMessage: success ? undefined : `All ${chunks.length} chunks failed`
  };
}

/**
 * Extract text in a single request for PDFs ≤ 100 pages
 */
async function extractTextSingleRequest(
  pdfBuffer: Uint8Array,
  pageCount: number,
  options: ClaudeOCROptions,
  isFirstBatch: boolean = true,
  startPage: number = 1,
  endPage: number = 0,
  totalPages: number = 0
): Promise<ClaudeOCRResult> {
  const startTime = Date.now();
  const { anthropicKey, fileName, maxRetries = 3 } = options;
  
  // Use provided values or defaults
  const actualEndPage = endPage || pageCount;
  const actualTotalPages = totalPages || pageCount;
  
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
                  text: getOCRPrompt(isFirstBatch, startPage, actualEndPage, actualTotalPages)
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
    
    console.log(`[ClaudeOCR] ✅ Success: ${extractedText.length} chars, ${pageCount} pages`);
    
    return {
      success: true,
      text: extractedText,
      pageCount: pageCount,
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
