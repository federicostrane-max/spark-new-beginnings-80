/**
 * Metadata Enrichment for Pipeline C
 * Arricchisce chunk con metadata avanzati
 */

interface EnrichedMetadata {
  chunk_type: 'narrative' | 'technical' | 'reference';
  semantic_weight: number;
  position: 'intro' | 'body' | 'conclusion';
  headings: string[];
  keywords: string[];
  document_section: string;
  page_number?: number;
  visual_grounding?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

interface RawChunk {
  content: string;
  chunk_index: number;
  page_number?: number;
}

/**
 * Arricchisce chunk con metadata avanzati
 */
export function enrichChunkMetadata(
  chunk: RawChunk,
  fullText: string,
  totalChunks: number
): EnrichedMetadata {
  return {
    chunk_type: detectChunkType(chunk.content),
    semantic_weight: calculateSemanticWeight(chunk.content),
    position: determinePosition(chunk.chunk_index, totalChunks),
    headings: extractHeadings(chunk.content),
    keywords: extractKeywords(chunk.content),
    document_section: detectDocumentSection(chunk.content),
    page_number: chunk.page_number,
    visual_grounding: undefined, // Placeholder per future implementazioni
  };
}

/**
 * Rileva tipo di chunk
 */
function detectChunkType(content: string): 'narrative' | 'technical' | 'reference' {
  const codeIndicators = ['function', 'class', 'const', 'let', 'var', 'import', 'export', '```'];
  const referenceIndicators = ['|', '---', '###', '- ', '* ', '1.', '2.', '3.'];
  
  const codeScore = codeIndicators.reduce(
    (score, indicator) => score + (content.includes(indicator) ? 1 : 0),
    0
  );
  
  const referenceScore = referenceIndicators.reduce(
    (score, indicator) => score + (content.includes(indicator) ? 1 : 0),
    0
  );
  
  if (codeScore > 2) return 'technical';
  if (referenceScore > 3) return 'reference';
  return 'narrative';
}

/**
 * Calcola peso semantico
 */
function calculateSemanticWeight(content: string): number {
  const words = content.split(/\s+/);
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  
  // Metriche di densità
  const uniqueRatio = uniqueWords.size / words.length;
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const sentenceCount = content.split(/[.!?]+/).length;
  const avgSentenceLength = words.length / sentenceCount;
  
  // Combinazione weighted
  const densityScore = uniqueRatio * 0.4;
  const complexityScore = Math.min(1, avgWordLength / 10) * 0.3;
  const structureScore = Math.min(1, avgSentenceLength / 20) * 0.3;
  
  return Math.min(1, densityScore + complexityScore + structureScore);
}

/**
 * Determina posizione nel documento
 */
function determinePosition(
  chunkIndex: number,
  totalChunks: number
): 'intro' | 'body' | 'conclusion' {
  const relativePosition = chunkIndex / totalChunks;
  
  if (relativePosition < 0.2) return 'intro';
  if (relativePosition > 0.8) return 'conclusion';
  return 'body';
}

/**
 * Estrae headings dal chunk
 */
function extractHeadings(content: string): string[] {
  const headingPattern = /^#+\s+(.+)$/gm;
  const headings: string[] = [];
  
  let match;
  while ((match = headingPattern.exec(content)) !== null) {
    headings.push(match[1].trim());
  }
  
  return headings.length > 0 ? headings : ['No Section'];
}

/**
 * Estrae keywords dal chunk usando TF-IDF semplificato
 */
export function extractKeywords(content: string, topN: number = 5): string[] {
  // Stopwords comuni (versione ridotta)
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'this', 'that', 'these', 'those', 'it', 'its', 'can', 'will', 'would',
  ]);
  
  // Tokenizza e pulisci
  const words = content
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => 
      word.length > 3 && 
      !stopwords.has(word) &&
      !/^\d+$/.test(word)
    );
  
  // Calcola frequenze
  const frequencies = new Map<string, number>();
  words.forEach(word => {
    frequencies.set(word, (frequencies.get(word) || 0) + 1);
  });
  
  // Ordina per frequenza e prendi top N
  return Array.from(frequencies.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

/**
 * Rileva sezione del documento
 */
function detectDocumentSection(content: string): string {
  const headings = extractHeadings(content);
  
  if (headings.length > 0 && headings[0] !== 'No Section') {
    return headings[0];
  }
  
  // Fallback: usa prime parole del chunk
  const firstLine = content.split('\n')[0].trim();
  if (firstLine.length > 0 && firstLine.length < 100) {
    return firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : '');
  }
  
  return 'Unknown Section';
}

/**
 * Batch enrichment per performance
 */
export function enrichChunksBatch(
  chunks: RawChunk[],
  fullText: string
): EnrichedMetadata[] {
  return chunks.map(chunk => 
    enrichChunkMetadata(chunk, fullText, chunks.length)
  );
}
