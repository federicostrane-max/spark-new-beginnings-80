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

  try {
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
      console.warn('[MarkdownParser] Table summarization failed, using default');
      return 'Tabella con dati strutturati';
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || 'Tabella con dati strutturati';
    return summary;
  } catch (error) {
    console.warn('[MarkdownParser] Table summarization error:', error);
    return 'Tabella con dati strutturati';
  }
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
      });
    } else if (element.type === 'code_block') {
      // Code blocks: use FULL content for embedding (no summary)
      nodes.push({
        chunk_index: i,
        content: originalContent,      // Full code block for embedding
        original_content: originalContent,
        summary: undefined,
        chunk_type: 'code_block',
        is_atomic: true,
        heading_hierarchy: headingContext,
        page_number: undefined,
      });
    } else if (element.type === 'list') {
      // Lists: use FULL content for embedding (no summary)
      nodes.push({
        chunk_index: i,
        content: originalContent,      // Full list for embedding
        original_content: originalContent,
        summary: undefined,
        chunk_type: 'list',
        is_atomic: true,
        heading_hierarchy: headingContext,
        page_number: undefined,
      });
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
      });
    }
  }

  return nodes;
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
      
      // Skip if section is entirely within atomic range
      const inAtomicRange = atomicRanges.some(
        range => sectionLineStart >= range.start && sectionLineStart < range.end
      );
      if (inAtomicRange) continue;
      
      // Extract heading hierarchy
      const headings = { h1: '', h2: '', h3: '' };
      for (const line of sectionLines) {
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
      
      // If section fits in maxChunkSize, keep it whole
      if (section.length <= maxChunkSize) {
        nodes.push({
          chunk_index: chunkIndex++,
          content: section.trim(),
          chunk_type: 'text',
          is_atomic: false,
          heading_hierarchy: { ...headings },
          page_number: pageNum + 1,
        });
      } else {
        // LEVEL 3: Section too large, split by paragraphs (\n\n)
        const paragraphs = section.split(/\n\n+/);
        let currentChunk: string[] = [];
        
        for (const paragraph of paragraphs) {
          if (!paragraph.trim()) continue;
          
          const testChunk = [...currentChunk, paragraph].join('\n\n');
          
          if (testChunk.length > maxChunkSize && currentChunk.length > 0) {
            // Flush current chunk
            nodes.push({
              chunk_index: chunkIndex++,
              content: currentChunk.join('\n\n').trim(),
              chunk_type: 'text',
              is_atomic: false,
              heading_hierarchy: { ...headings },
              page_number: pageNum + 1,
            });
            currentChunk = [paragraph];
          } else {
            currentChunk.push(paragraph);
          }
        }
        
        // Flush remaining paragraphs
        if (currentChunk.length > 0) {
          nodes.push({
            chunk_index: chunkIndex++,
            content: currentChunk.join('\n\n').trim(),
            chunk_type: 'text',
            is_atomic: false,
            heading_hierarchy: { ...headings },
            page_number: pageNum + 1,
          });
        }
      }
    }
  }

  return nodes;
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

  // Step 0: Build heading map for contextual assignment
  const headingMap = buildHeadingMap(markdown);
  console.log(`[MarkdownParser] Built heading map with ${headingMap.size} lines`);

  // Step 1: Extract atomic elements (tables, code blocks, lists, figures) with heading context
  const atomicNodes = await extractAtomicElements(markdown, lovableApiKey, headingMap);
  console.log(`[MarkdownParser] Found ${atomicNodes.length} atomic elements`);

  // Step 2: Identify atomic ranges to skip during text chunking
  const atomicElements = identifyAtomicElements(markdown);
  
  // Step 3: Chunk remaining text content
  const textNodes = chunkTextContent(markdown, atomicElements);
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
