/**
 * Chunk text into overlapping segments for RAG
 * @param text - The text to chunk
 * @param chunkSize - Maximum characters per chunk
 * @param overlap - Number of characters to overlap between chunks
 * @returns Array of text chunks
 */
export function chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  
  return chunks;
}