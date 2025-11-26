/**
 * Recursive Retriever Helper
 * 
 * Implements the "Small-to-Big" retrieval pattern:
 * - Semantic search finds summaries (small, optimized for embedding)
 * - Before passing to LLM, swap summaries with original content (big, complete context)
 * 
 * This ensures:
 * 1. Efficient semantic search on concise summaries
 * 2. LLM receives full, untruncated content (e.g., complete Markdown tables)
 * 3. Zero information loss during retrieval
 */

export interface ChunkWithRecursiveRetrieval {
  id: string;
  pool_document_id: string;
  document_name: string;
  content: string;              // Summary (for search)
  original_content?: string;    // Full content (for LLM)
  summary?: string;
  chunk_type: string;
  is_atomic: boolean;
  similarity: number;
}

/**
 * Swap summary content with original content for atomic elements
 * 
 * This is the core of Recursive Retrieval:
 * - If chunk is atomic (table/code) AND has original_content
 * - Return original_content instead of summary
 * - Otherwise return content as-is
 * 
 * @param chunks - Retrieved chunks from semantic search
 * @returns Chunks with summaries replaced by original content where applicable
 */
export function swapSummaryWithOriginal(
  chunks: ChunkWithRecursiveRetrieval[]
): ChunkWithRecursiveRetrieval[] {
  return chunks.map(chunk => {
    // RECURSIVE RETRIEVAL SWAP
    if (chunk.is_atomic && chunk.original_content) {
      console.log(`[RecursiveRetriever] Swapping summary with original for chunk ${chunk.id} (${chunk.chunk_type})`);
      
      return {
        ...chunk,
        content: chunk.original_content, // LLM gets full Markdown table
      };
    }

    // Non-atomic or no original_content: return as-is
    return chunk;
  });
}

/**
 * Format chunks for LLM context with metadata
 * @param chunks - Chunks with swapped content
 * @returns Formatted string for system prompt injection
 */
export function formatChunksForContext(
  chunks: ChunkWithRecursiveRetrieval[]
): string {
  if (chunks.length === 0) return '';

  const contextParts = chunks.map((chunk, idx) => {
    const metadata = [
      `Documento: ${chunk.document_name}`,
      `Tipo: ${chunk.chunk_type}`,
      `Similarità: ${(chunk.similarity * 100).toFixed(1)}%`,
    ].join(' | ');

    return `[Chunk ${idx + 1}] ${metadata}\n${chunk.content}`;
  });

  return contextParts.join('\n\n---\n\n');
}

/**
 * Check if recursive retrieval was applied
 * @param chunks - Original chunks from database
 * @returns Count of chunks that had summaries swapped
 */
export function countRecursiveSwaps(
  chunks: ChunkWithRecursiveRetrieval[]
): number {
  return chunks.filter(chunk => chunk.is_atomic && chunk.original_content).length;
}
