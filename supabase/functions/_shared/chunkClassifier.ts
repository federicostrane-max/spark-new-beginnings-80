/**
 * Chunk Classification for Pipeline C
 * Classifica chunk per tipo e rileva caratteristiche tecniche
 */

export type SectionType = 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'quote';
export type ChunkType = 'narrative' | 'technical' | 'reference';

/**
 * Rileva tipo di sezione
 */
export function detectSectionType(content: string): SectionType {
  // Code blocks (priorità alta)
  if (content.includes('```') || content.match(/^[\s]{4,}/gm)) {
    return 'code';
  }
  
  // Tabelle (Markdown-style)
  if (content.includes('|') && content.includes('---')) {
    return 'table';
  }
  
  // Liste
  const listPattern = /^[\s]*[-*+]\s+/gm;
  if (listPattern.test(content) || /^\d+\.\s+/gm.test(content)) {
    return 'list';
  }
  
  // Headings
  if (content.match(/^#+\s+/gm)) {
    return 'heading';
  }
  
  // Quote
  if (content.match(/^>\s+/gm)) {
    return 'quote';
  }
  
  // Default: paragraph
  return 'paragraph';
}

/**
 * Determina chunk type (narrative, technical, reference)
 */
export function determineChunkType(content: string): ChunkType {
  const sectionType = detectSectionType(content);
  
  // Code e tabelle sono sempre technical
  if (sectionType === 'code' || sectionType === 'table') {
    return 'technical';
  }
  
  // Liste sono sempre reference
  if (sectionType === 'list') {
    return 'reference';
  }
  
  // Analisi più profonda per paragraph e heading
  const technicalScore = calculateTechnicalScore(content);
  const referenceScore = calculateReferenceScore(content);
  
  if (technicalScore > 0.5) return 'technical';
  if (referenceScore > 0.5) return 'reference';
  return 'narrative';
}

/**
 * Calcola score tecnico del contenuto
 */
function calculateTechnicalScore(content: string): number {
  let score = 0;
  
  // Termini tecnici comuni
  const technicalTerms = [
    /\b(function|class|interface|type|const|let|var)\b/gi,
    /\b(import|export|return|async|await)\b/gi,
    /\b(algorithm|complexity|optimization|performance)\b/gi,
    /\b(API|HTTP|JSON|XML|SQL|database)\b/gi,
    /\b(array|object|string|number|boolean)\b/gi,
  ];
  
  technicalTerms.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) score += matches.length * 0.1;
  });
  
  // CamelCase identifiers
  const camelCaseCount = (content.match(/\b[a-z]+[A-Z][a-zA-Z]*\b/g) || []).length;
  score += camelCaseCount * 0.05;
  
  // Code symbols
  const codeSymbols = ['{', '}', '(', ')', ';', '=>', '===', '!=='];
  codeSymbols.forEach(symbol => {
    const count = content.split(symbol).length - 1;
    score += count * 0.02;
  });
  
  return Math.min(1, score);
}

/**
 * Calcola score di reference del contenuto
 */
function calculateReferenceScore(content: string): number {
  let score = 0;
  
  // Liste numerate o bullet
  const listItems = content.match(/^[\s]*[-*+]\s+/gm) || [];
  const numberedItems = content.match(/^\d+\.\s+/gm) || [];
  score += (listItems.length + numberedItems.length) * 0.15;
  
  // Tabelle
  if (content.includes('|') && content.includes('---')) {
    score += 0.3;
  }
  
  // Definizioni (pattern "Termine: definizione")
  const definitions = content.match(/\b\w+:\s+\w+/g) || [];
  score += definitions.length * 0.1;
  
  // Link e riferimenti
  const links = content.match(/\[.+?\]\(.+?\)/g) || [];
  const urls = content.match(/https?:\/\/\S+/g) || [];
  score += (links.length + urls.length) * 0.1;
  
  return Math.min(1, score);
}

/**
 * Rileva termini tecnici nel contenuto
 */
export function detectTechnicalTerms(content: string): string[] {
  const technicalPatterns = [
    // Programming keywords
    /\b(function|class|interface|type|const|let|var|import|export|return|async|await)\b/gi,
    // Tech concepts
    /\b(algorithm|data structure|complexity|optimization|performance|scalability)\b/gi,
    // Technologies
    /\b(API|HTTP|REST|GraphQL|JSON|XML|SQL|NoSQL|database|Redis|MongoDB)\b/gi,
    // CamelCase identifiers
    /\b[a-z]+[A-Z][a-zA-Z]*\b/g,
  ];
  
  const terms = new Set<string>();
  
  technicalPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => terms.add(match.toLowerCase()));
    }
  });
  
  return Array.from(terms);
}

/**
 * Analizza densità concettuale
 */
export function analyzeConceptDensity(content: string): number {
  const words = content.split(/\s+/);
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  
  // Ratio parole unique / totali
  const uniqueRatio = uniqueWords.size / words.length;
  
  // Lunghezza media parole (parole più lunghe = concetti più complessi)
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const lengthScore = Math.min(1, avgWordLength / 8);
  
  // Frasi complesse (più di 15 parole per frase)
  const sentences = content.split(/[.!?]+/);
  const complexSentences = sentences.filter(s => s.split(/\s+/).length > 15).length;
  const complexityScore = complexSentences / sentences.length;
  
  // Combinazione weighted
  return (uniqueRatio * 0.4) + (lengthScore * 0.3) + (complexityScore * 0.3);
}

/**
 * Classifica batch di chunk
 */
export function classifyChunksBatch(chunks: string[]): {
  chunk: string;
  sectionType: SectionType;
  chunkType: ChunkType;
  technicalScore: number;
  referenceScore: number;
  conceptDensity: number;
}[] {
  return chunks.map(chunk => ({
    chunk,
    sectionType: detectSectionType(chunk),
    chunkType: determineChunkType(chunk),
    technicalScore: calculateTechnicalScore(chunk),
    referenceScore: calculateReferenceScore(chunk),
    conceptDensity: analyzeConceptDensity(chunk),
  }));
}
