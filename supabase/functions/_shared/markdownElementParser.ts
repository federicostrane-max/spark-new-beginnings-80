/**
 * Markdown Element Parser
 * 
 * Core innovation for Pipeline A: Parses structured Markdown from LlamaParse
 * and implements Small-to-Big Recursive Retrieval architecture.
 * 
 * Key Features:
 * - Identifies atomic elements (tables, code blocks) that must never be split
 * - Generates LLM summaries for tables (indexed for search)
 * - Preserves original Markdown content for LLM generation
 * - Tracks heading hierarchy for semantic context
 */

const ATOMIC_ELEMENT_SIZE_THRESHOLD = 1500; // Caratteri oltre i quali generare summary
const MIN_TEXT_CHUNK_SIZE = 100; // Scarta chunk di testo troppo piccoli

// Small-to-Big Retrieval Configuration
const PARENT_CHUNK_SIZE = 4000;   // ~1000 token - contesto quasi a pagina
const CHILD_CHUNK_SIZE = 500;     // ~128-150 token - precisione ricerca
const PARENT_OVERLAP = 200;       // Overlap tra parent chunks
const CHILD_OVERLAP = 50;         // Overlap tra child chunks

interface ExtractedMetadata {
  dates?: string[];
  emails?: string[];
  urls?: string[];
}

export interface ParsedNode {
  chunk_index: number;
  content: string;              // For embedding (summary for tables)
  original_content?: string;    // Full Markdown (for tables)
  summary?: string;             // LLM-generated summary
  chunk_type: 'text' | 'table' | 'code_block' | 'list' | 'figure' | 'header';
  is_atomic: boolean;           // Cannot be split
  heading_hierarchy?: {
    h1?: string;
    h2?: string;
    h3?: string;
  };
  page_number?: number;
  extracted_metadata?: ExtractedMetadata;
}

export interface ParseResult {
  baseNodes: ParsedNode[];
  objectsMap: Map<string, ParsedNode>;
}

/**
 * Identify atomic elements in Markdown (tables, code blocks, lists, figures)
 * @param markdown - Input Markdown content
 * @returns Array of atomic element ranges
 */
function identifyAtomicElements(markdown: string): Array<{ start: number; end: number; type: 'table' | 'code_block' | 'list' | 'figure' }> {
  const elements: Array<{ start: number; end: number; type: 'table' | 'code_block' | 'list' | 'figure' }> = [];
  const lines = markdown.split('\n');
  
  let inCodeBlock = false;
  let codeBlockStart = -1;
  let inTable = false;
  let tableStart = -1;
  let inList = false;
  let listStart = -1;
  let inFigure = false;
  let figureStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Code block detection
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockStart = i;
      } else {
        inCodeBlock = false;
        elements.push({
          start: codeBlockStart,
          end: i + 1,
          type: 'code_block',
        });
      }
      continue;
    }

    // Figure detection (pattern: **Figura X:... or **Figure X:...)
    const isFigureLine = line.startsWith('**Figura') || line.startsWith('**Figure');
    if (isFigureLine && !inCodeBlock) {
      inFigure = true;
      figureStart = i;
    } else if (inFigure && (line === '' || line === '---')) {
      // Figure ended at empty line or page separator
      inFigure = false;
      elements.push({
        start: figureStart,
        end: i,
        type: 'figure',
      });
    }

    // Table detection (any line with |...|)
    const isTableLine = line.includes('|') && line.split('|').length > 2;
    if (isTableLine && !inCodeBlock && !inFigure) {
      if (!inTable) {
        inTable = true;
        tableStart = i;
      }
    } else if (inTable && !isTableLine) {
      // Table ended
      inTable = false;
      elements.push({
        start: tableStart,
        end: i,
        type: 'table',
      });
    }

    // List detection (bulleted or numbered)
    const isListLine = /^(\d+\.|[-*+])\s/.test(line) || /^\s{2,}(\d+\.|[-*+])\s/.test(line);
    if (isListLine && !inCodeBlock && !inTable && !inFigure) {
      if (!inList) {
        inList = true;
        listStart = i;
      }
    } else if (inList && !isListLine && line.length > 0) {
      // List ended (non-empty line that's not a list item)
      inList = false;
      elements.push({
        start: listStart,
        end: i,
        type: 'list',
      });
    }
  }

  // Close any unclosed elements at end of document
  if (inTable) {
    elements.push({
      start: tableStart,
      end: lines.length,
      type: 'table',
    });
  }
  if (inList) {
    elements.push({
      start: listStart,
      end: lines.length,
      type: 'list',
    });
  }
  if (inFigure) {
    elements.push({
      start: figureStart,
      end: lines.length,
      type: 'figure',
    });
  }

  return elements;
}

/**
 * Build a heading map: for each line, track current heading context
 * @param markdown - Full Markdown content
 * @returns Map of line numbers to heading hierarchy
 */
function buildHeadingMap(markdown: string): Map<number, { h1?: string; h2?: string; h3?: string }> {
  const headingMap = new Map<number, { h1?: string; h2?: string; h3?: string }>();
  const lines = markdown.split('\n');
  
  let currentH1 = '';
  let currentH2 = '';
  let currentH3 = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.startsWith('# ')) {
      currentH1 = line.replace(/^#\s+/, '');
      currentH2 = '';
      currentH3 = '';
    } else if (line.startsWith('## ')) {
      currentH2 = line.replace(/^##\s+/, '');
      currentH3 = '';
    } else if (line.startsWith('### ')) {
      currentH3 = line.replace(/^###\s+/, '');
    }
    
    // Store current heading context for this line
    headingMap.set(i, {
      h1: currentH1 || undefined,
      h2: currentH2 || undefined,
      h3: currentH3 || undefined,
    });
  }

  return headingMap;
}

/**
 * Retry with exponential backoff for API calls
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  context: string = 'API call'
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[${context}] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Should not reach here');
}

/**
 * Extract metadata from content using pattern-based detection
 */
function extractMetadataFromContent(content: string): ExtractedMetadata {
  return {
    dates: content.match(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g) || undefined,
    emails: content.match(/[\w.-]+@[\w.-]+\.\w+/g) || undefined,
    urls: content.match(/https?:\/\/[^\s\)]+/g) || undefined,
  };
}

/**
 * Find the best word boundary near a target position
 * Priority: Paragraphs > Sentences > Spaces > Never mid-word
 */
function findWordBoundary(text: string, targetPos: number): number {
  if (targetPos >= text.length) return text.length;
  if (targetPos <= 0) return 0;

  // Search window: ±50 chars from target
  const searchStart = Math.max(0, targetPos - 50);
  const searchEnd = Math.min(text.length, targetPos + 50);
  const searchWindow = text.substring(searchStart, searchEnd);
  const relativeTarget = targetPos - searchStart;

  // Priority 1: Paragraph boundary (\n\n)
  const paragraphBoundaries: number[] = [];
  let pos = 0;
  while ((pos = searchWindow.indexOf('\n\n', pos)) !== -1) {
    paragraphBoundaries.push(pos);
    pos += 2;
  }
  if (paragraphBoundaries.length > 0) {
    const closest = paragraphBoundaries.reduce((prev, curr) => 
      Math.abs(curr - relativeTarget) < Math.abs(prev - relativeTarget) ? curr : prev
    );
    return searchStart + closest + 2; // +2 to skip \n\n
  }

  // Priority 2: Sentence boundary (. ! ?)
  const sentenceBoundaries: number[] = [];
  const sentenceRegex = /[.!?]\s+/g;
  let match;
  while ((match = sentenceRegex.exec(searchWindow)) !== null) {
    sentenceBoundaries.push(match.index + match[0].length);
  }
  if (sentenceBoundaries.length > 0) {
    const closest = sentenceBoundaries.reduce((prev, curr) => 
      Math.abs(curr - relativeTarget) < Math.abs(prev - relativeTarget) ? curr : prev
    );
    return searchStart + closest;
  }

  // Priority 3: Space boundary
  const spaceBoundaries: number[] = [];
  pos = 0;
  while ((pos = searchWindow.indexOf(' ', pos)) !== -1) {
    spaceBoundaries.push(pos);
    pos++;
  }
  if (spaceBoundaries.length > 0) {
    const closest = spaceBoundaries.reduce((prev, curr) => 
      Math.abs(curr - relativeTarget) < Math.abs(prev - relativeTarget) ? curr : prev
    );
    return searchStart + closest + 1; // +1 to skip space
  }

  // Fallback: target position (never mid-word guarantee failed)
  console.warn('[findWordBoundary] No boundary found in search window, using target position');
  return targetPos;
}

/**
 * Create parent chunks (~4000 chars) with intelligent overlap
 */
function createParentChunks(
  text: string,
  headings: { h1: string; h2: string; h3: string },
  pageNum: number
): Array<{ content: string; heading_hierarchy: any; page_number: number }> {
  const parents: Array<{ content: string; heading_hierarchy: any; page_number: number }> = [];
  
  let start = 0;
  while (start < text.length) {
    const targetEnd = start + PARENT_CHUNK_SIZE;
    const actualEnd = findWordBoundary(text, targetEnd);
    
    const content = text.substring(start, actualEnd).trim();
    if (content.length >= MIN_TEXT_CHUNK_SIZE) {
      parents.push({
        content,
        heading_hierarchy: { ...headings },
        page_number: pageNum,
      });
    }
    
    // Move to next chunk with overlap
    start = actualEnd - PARENT_OVERLAP;
    if (start >= text.length - PARENT_OVERLAP) break; // Avoid tiny trailing chunks
  }
  
  return parents;
}

/**
 * Create child chunks (~500 chars) from a parent chunk
 */
function createChildChunks(parentContent: string): string[] {
  const children: string[] = [];
  
  let start = 0;
  while (start < parentContent.length) {
    const targetEnd = start + CHILD_CHUNK_SIZE;
    const actualEnd = findWordBoundary(parentContent, targetEnd);
    
    const content = parentContent.substring(start, actualEnd).trim();
    if (content.length >= MIN_TEXT_CHUNK_SIZE) {
      children.push(content);
    }
    
    // Move to next chunk with overlap
    start = actualEnd - CHILD_OVERLAP;
    if (start >= parentContent.length - CHILD_OVERLAP) break;
  }
  
  return children;
}

/**
 * Generate summary for a table using LLM helper
 * @param tableMarkdown - Table Markdown content
 * @param lovableApiKey - Lovable AI Gateway API key
 * @returns Summary text
 */
async function summarizeTable(
  tableMarkdown: string,
  lovableApiKey: string
): Promise<string> {
  const prompt = `Riassumi questa tabella in una frase concisa, descrivendo i dati principali e il loro scopo:\n\n${tableMarkdown}`;

  return retryWithBackoff(async () => {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Sei un assistente che riassume tabelle in modo conciso.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new Error('Empty summary');
    return summary;
  }, 3, 1000, 'summarizeTable').catch(err => {
    console.warn('[MarkdownParser] Table summarization failed after retries:', err);
    return 'Tabella con dati strutturati';
  });
}

/**
 * Generate summary for a code block using LLM helper
 * NOTA TECNICA 3: Identifica linguaggio e librerie per migliorare semantic search
 */
async function summarizeCodeBlock(
  code: string,
  lovableApiKey: string
): Promise<string> {
  const prompt = `Analizza questo codice. Identifica il linguaggio, le librerie principali e riassumi in una frase la logica funzionale e l'obiettivo di questo script:

${code.substring(0, 2000)}`;

  return retryWithBackoff(async () => {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Sei un esperto programmatore che analizza e riassume blocchi di codice identificando linguaggio e librerie.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || 'Blocco di codice con logica implementativa';
  }, 3, 1000, 'summarizeCodeBlock').catch(() => 'Blocco di codice con logica implementativa');
}

/**
 * Generate summary for a list using LLM helper
 */
async function summarizeList(
  listContent: string,
  lovableApiKey: string
): Promise<string> {
  const prompt = `Riassumi in una frase i punti principali di questa lista:

${listContent.substring(0, 2000)}`;

  return retryWithBackoff(async () => {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Sei un assistente che riassume liste in modo conciso.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || 'Elenco con elementi informativi';
  }, 3, 1000, 'summarizeList').catch(() => 'Elenco con elementi informativi');
}

/**
 * Extract atomic elements (tables, code blocks, lists, figures) with summaries and heading context
 * @param markdown - Full Markdown content
 * @param lovableApiKey - Lovable AI API key for summarization
 * @param headingMap - Map of line numbers to heading hierarchy
 * @returns Array of parsed nodes for atomic elements
 */
async function extractAtomicElements(
  markdown: string,
  lovableApiKey: string,
  headingMap: Map<number, { h1?: string; h2?: string; h3?: string }>
): Promise<ParsedNode[]> {
  const lines = markdown.split('\n');
  const atomicElements = identifyAtomicElements(markdown);
  const nodes: ParsedNode[] = [];

  for (let i = 0; i < atomicElements.length; i++) {
    const element = atomicElements[i];
    const elementLines = lines.slice(element.start, element.end);
    const originalContent = elementLines.join('\n');
    
    // Get heading context for this element
    const headingContext = headingMap.get(element.start) || {};

    // Extract metadata from content
    const extracted_metadata = extractMetadataFromContent(originalContent);

    if (element.type === 'table') {
      // Generate summary for table
      const summary = await summarizeTable(originalContent, lovableApiKey);
      
      nodes.push({
        chunk_index: i,
        content: summary,              // Summary for embedding
        original_content: originalContent, // Full table for LLM
        summary,
        chunk_type: 'table',
        is_atomic: true,
        heading_hierarchy: headingContext,
        page_number: undefined, // Will be set during final merge
        extracted_metadata: (extracted_metadata.dates || extracted_metadata.emails || extracted_metadata.urls) 
          ? extracted_metadata : undefined,
      });
    } else if (element.type === 'code_block') {
      // FIX 2: Small-to-Big for large code blocks
      if (originalContent.length > ATOMIC_ELEMENT_SIZE_THRESHOLD) {
        const summary = await summarizeCodeBlock(originalContent, lovableApiKey);
        nodes.push({
          chunk_index: i,
          content: summary,                   // Summary per embedding
          original_content: originalContent,  // Codice completo per LLM
          summary,
          chunk_type: 'code_block',
          is_atomic: true,
          heading_hierarchy: headingContext,
          page_number: undefined,
          extracted_metadata: (extracted_metadata.dates || extracted_metadata.emails || extracted_metadata.urls) 
            ? extracted_metadata : undefined,
        });
      } else {
        // Small code block: use full content
        nodes.push({
          chunk_index: i,
          content: originalContent,
          original_content: originalContent,
          summary: undefined,
          chunk_type: 'code_block',
          is_atomic: true,
          heading_hierarchy: headingContext,
          page_number: undefined,
          extracted_metadata: (extracted_metadata.dates || extracted_metadata.emails || extracted_metadata.urls) 
            ? extracted_metadata : undefined,
        });
      }
    } else if (element.type === 'list') {
      // FIX 2: Small-to-Big for large lists
      if (originalContent.length > ATOMIC_ELEMENT_SIZE_THRESHOLD) {
        const summary = await summarizeList(originalContent, lovableApiKey);
        nodes.push({
          chunk_index: i,
          content: summary,                   // Summary per embedding
          original_content: originalContent,  // Lista completa per LLM
          summary,
          chunk_type: 'list',
          is_atomic: true,
          heading_hierarchy: headingContext,
          page_number: undefined,
          extracted_metadata: (extracted_metadata.dates || extracted_metadata.emails || extracted_metadata.urls) 
            ? extracted_metadata : undefined,
        });
      } else {
        // Small list: use full content
        nodes.push({
          chunk_index: i,
          content: originalContent,
          original_content: originalContent,
          summary: undefined,
          chunk_type: 'list',
          is_atomic: true,
          heading_hierarchy: headingContext,
          page_number: undefined,
          extracted_metadata: (extracted_metadata.dates || extracted_metadata.emails || extracted_metadata.urls) 
            ? extracted_metadata : undefined,
        });
      }
    } else if (element.type === 'figure') {
      // Figures: use full description for embedding
      nodes.push({
        chunk_index: i,
        content: originalContent,      // Full figure description for embedding
        original_content: originalContent,
        summary: undefined,
        chunk_type: 'figure',
        is_atomic: true,
        heading_hierarchy: headingContext,
        page_number: undefined,
        extracted_metadata: (extracted_metadata.dates || extracted_metadata.emails || extracted_metadata.urls) 
          ? extracted_metadata : undefined,
      });
    }
  }

  return nodes;
}

/**
 * FIX 3: Recursive split for long paragraphs
 * NOTA TECNICA 2: La regex può spezzare su abbreviazioni (art. 5, Mr. Smith)
 * ma è preferibile over-splitting rispetto a chunk giganti
 */
function splitLargeParagraph(paragraph: string, maxSize: number): string[] {
  if (paragraph.length <= maxSize) return [paragraph];
  
  const chunks: string[] = [];
  
  // Level 4: Split per frasi (accetta over-splitting su abbreviazioni)
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + ' ' + sentence).length > maxSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  
  // Level 5: FAILSAFE - se ancora troppo grande, split per caratteri
  return chunks.flatMap(chunk => {
    if (chunk.length <= maxSize) return [chunk];
    console.warn(`[MarkdownParser] Forcing character split for chunk of ${chunk.length} chars`);
    const subChunks: string[] = [];
    for (let i = 0; i < chunk.length; i += maxSize) {
      subChunks.push(chunk.substring(i, i + maxSize));
    }
    return subChunks;
  });
}

/**
 * Markdown-Aware Chunker: 3-level splitting strategy
 * Level 1: Page separators (---)
 * Level 2: Headings (#, ##, ###)
 * Level 3: Paragraphs (\n\n)
 * 
 * @param markdown - Markdown content
 * @param atomicRanges - Ranges occupied by atomic elements (to skip)
 * @param maxChunkSize - Maximum chunk size in characters
 * @returns Array of text chunk nodes with page tracking
 */
function chunkTextContent(
  markdown: string,
  atomicRanges: Array<{ start: number; end: number }>,
  maxChunkSize: number = 1500
): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  let chunkIndex = 0;

  // LEVEL 1: Split by page separators (---)
  const pages = markdown.split(/\n---\n/);
  
  for (let pageNum = 0; pageNum < pages.length; pageNum++) {
    const pageContent = pages[pageNum];
    const pageLines = pageContent.split('\n');
    
    // Calculate line offset for this page in original document
    const lineOffset = pages.slice(0, pageNum).reduce((acc, page) => acc + page.split('\n').length + 1, 0);
    
    // LEVEL 2: Split by headings (preserve heading with its content)
    const sections = pageContent.split(/(?=^#{1,3}\s)/m);
    
    for (const section of sections) {
      if (!section.trim()) continue;
      
      const sectionLines = section.split('\n');
      const sectionLineStart = lineOffset + pageLines.indexOf(sectionLines[0]);
      
      // FIX 2: Filtra linea per linea le righe già in elementi atomici (deduplicazione)
      const filteredSectionLines = sectionLines.filter((_, lineIdx) => {
        const absoluteLineNum = sectionLineStart + lineIdx;
        return !atomicRanges.some(
          range => absoluteLineNum >= range.start && absoluteLineNum < range.end
        );
      });
      
      const filteredSection = filteredSectionLines.join('\n').trim();
      
      // Scarta sezioni vuote o troppo piccole dopo il filtro
      if (!filteredSection || filteredSection.length < MIN_TEXT_CHUNK_SIZE) continue;
      
      
      // Extract heading hierarchy from filteredSection
      const headings = { h1: '', h2: '', h3: '' };
      for (const line of filteredSectionLines) {
        if (line.startsWith('# ')) {
          headings.h1 = line.replace(/^#\s+/, '');
          headings.h2 = '';
          headings.h3 = '';
        } else if (line.startsWith('## ')) {
          headings.h2 = line.replace(/^##\s+/, '');
          headings.h3 = '';
        } else if (line.startsWith('### ')) {
          headings.h3 = line.replace(/^###\s+/, '');
        }
      }
      
      // SMALL-TO-BIG RETRIEVAL: Two-step splitting
      // Step 1: Create PARENT chunks (~4000 chars)
      const parentChunks = createParentChunks(filteredSection, headings, pageNum + 1);
      
      // Step 2: For each PARENT, create CHILD chunks (~500 chars)
      for (const parent of parentChunks) {
        const childChunks = createChildChunks(parent.content);
        
        for (const childContent of childChunks) {
          const extracted_metadata = extractMetadataFromContent(childContent);
          nodes.push({
            chunk_index: chunkIndex++,
            content: childContent,              // ★ CHILD per embedding (500 chars)
            original_content: parent.content,   // ★ PARENT per LLM (4000 chars)
            chunk_type: 'text',
            is_atomic: false,
            heading_hierarchy: parent.heading_hierarchy,
            page_number: parent.page_number,
            extracted_metadata: (extracted_metadata.dates || extracted_metadata.emails || extracted_metadata.urls) 
              ? extracted_metadata : undefined,
          });
        }
      }
    }
  }

  return nodes;
}

/**
 * Unwrap Markdown content that's wrapped in ```markdown or ```md code blocks
 * Common pattern when LLMs output Markdown wrapped in code delimiters
 */
function unwrapMarkdownCodeBlocks(markdown: string): string {
  // Pattern: ```markdown ... ``` or ```md ... ```
  return markdown.replace(/```(?:markdown|md)\s*\n([\s\S]*?)```/g, '$1');
}

/**
 * Main parsing function: Extract structured elements from Markdown
 * @param markdown - LlamaParse output Markdown
 * @param lovableApiKey - API key for table summarization
 * @returns Parsed nodes ready for database insertion
 */
export async function parseMarkdownElements(
  markdown: string,
  lovableApiKey: string
): Promise<ParseResult> {
  console.log('[MarkdownParser] Starting structured parsing...');

  // Step 0: Preprocess - unwrap markdown code blocks if present
  const cleanMarkdown = unwrapMarkdownCodeBlocks(markdown);
  if (cleanMarkdown !== markdown) {
    console.log('[MarkdownParser] Unwrapped markdown code block delimiters');
  }

  // Step 1: Build heading map for contextual assignment
  const headingMap = buildHeadingMap(cleanMarkdown);
  console.log(`[MarkdownParser] Built heading map with ${headingMap.size} lines`);

  // Step 2: Extract atomic elements (tables, code blocks, lists, figures) with heading context
  const atomicNodes = await extractAtomicElements(cleanMarkdown, lovableApiKey, headingMap);
  console.log(`[MarkdownParser] Found ${atomicNodes.length} atomic elements`);

  // Step 3: Identify atomic ranges to skip during text chunking
  const atomicElements = identifyAtomicElements(cleanMarkdown);
  
  // Step 4: Chunk remaining text content
  const textNodes = chunkTextContent(cleanMarkdown, atomicElements);
  console.log(`[MarkdownParser] Created ${textNodes.length} text chunks`);

  // Step 4: Combine and reindex
  const allNodes = [...atomicNodes, ...textNodes];
  allNodes.forEach((node, idx) => {
    node.chunk_index = idx;
  });

  // Step 5: Simplified objects map (RPC handles recursive retrieval via CASE statement)
  const objectsMap = new Map<string, ParsedNode>();

  console.log(`[MarkdownParser] Parsing complete: ${allNodes.length} total nodes`);

  return {
    baseNodes: allNodes,
    objectsMap,
  };
}
