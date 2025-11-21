/**
 * Chunking Service
 * Provides reliable text chunking with sliding window strategy
 */

export interface ChunkMetadata {
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  overlap: number;
  startChar: number;
  endChar: number;
}

export interface TextChunk {
  content: string;
  metadata: ChunkMetadata;
}

/**
 * Chunk text using sliding window with configurable size and overlap
 */
export function chunkText(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200
): TextChunk[] {
  if (!text || text.trim().length === 0) {
    console.warn('[chunkingService] Empty text provided');
    return [];
  }

  const chunks: TextChunk[] = [];
  const textLength = text.length;
  let position = 0;
  let chunkIndex = 0;

  // Calculate total chunks (approximate)
  const totalChunks = Math.ceil(textLength / (chunkSize - overlap));

  let lastPosition = -1;
  let safetyCounter = 0;
  const maxChunks = Math.ceil(textLength / (chunkSize - overlap)) + 10; // Extra margin

  while (position < textLength) {
    const end = Math.min(position + chunkSize, textLength);
    const chunkContent = text.slice(position, end);

    chunks.push({
      content: chunkContent,
      metadata: {
        chunkIndex,
        totalChunks,
        chunkSize,
        overlap,
        startChar: position,
        endChar: end,
      },
    });

    chunkIndex++;
    const newPosition = position + chunkSize - overlap;
    
    // Safety checks: prevent infinite loops
    if (newPosition === lastPosition) {
      console.warn('[chunkingService] Position not advancing, stopping to prevent infinite loop');
      break;
    }
    
    if (safetyCounter > maxChunks) {
      console.warn(`[chunkingService] Exceeded max expected chunks (${maxChunks}), stopping`);
      break;
    }
    
    lastPosition = position;
    position = newPosition;
    safetyCounter++;
  }

  console.log(`[chunkingService] Created ${chunks.length} chunks from ${textLength} characters`);
  return chunks;
}

/**
 * Validate chunk quality
 */
export function validateChunk(chunk: TextChunk): { valid: boolean; reason?: string } {
  if (!chunk.content || chunk.content.trim().length === 0) {
    return { valid: false, reason: 'Empty content' };
  }

  if (chunk.content.length < 50) {
    return { valid: false, reason: 'Content too short (< 50 chars)' };
  }

  if (chunk.content.length > 10000) {
    return { valid: false, reason: 'Content too long (> 10000 chars)' };
  }

  return { valid: true };
}
