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
  chunk_type: 'text' | 'table' | 'code_block' | 'list' | 'header';
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
 * Identify atomic elements in Markdown (tables, code blocks)
 * @param markdown - Input Markdown content
 * @returns Array of atomic element ranges
 */
function identifyAtomicElements(markdown: string): Array<{ start: number; end: number; type: 'table' | 'code_block' }> {
  const elements: Array<{ start: number; end: number; type: 'table' | 'code_block' }> = [];
  const lines = markdown.split('\n');
  
  let inCodeBlock = false;
  let codeBlockStart = -1;
  let inTable = false;
  let tableStart = -1;

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

    // Table detection (simplified: any line with |...|)
    const isTableLine = line.includes('|') && line.split('|').length > 2;
    if (isTableLine && !inCodeBlock) {
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
  }

  // Close any unclosed table at end of document
  if (inTable) {
    elements.push({
      start: tableStart,
      end: lines.length,
      type: 'table',
    });
  }

  return elements;
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
 * Extract atomic elements (tables, code blocks) with summaries
 * @param markdown - Full Markdown content
 * @param lovableApiKey - Lovable AI API key for summarization
 * @returns Array of parsed nodes for atomic elements
 */
async function extractAtomicElements(
  markdown: string,
  lovableApiKey: string
): Promise<ParsedNode[]> {
  const lines = markdown.split('\n');
  const atomicElements = identifyAtomicElements(markdown);
  const nodes: ParsedNode[] = [];

  for (let i = 0; i < atomicElements.length; i++) {
    const element = atomicElements[i];
    const elementLines = lines.slice(element.start, element.end);
    const originalContent = elementLines.join('\n');

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
      });
    } else if (element.type === 'code_block') {
      // Code blocks: use first line as summary
      const firstLine = elementLines[1] || 'Blocco di codice';
      
      nodes.push({
        chunk_index: i,
        content: firstLine.slice(0, 200),
        original_content: originalContent,
        summary: firstLine,
        chunk_type: 'code_block',
        is_atomic: true,
      });
    }
  }

  return nodes;
}

/**
 * Chunk text content by sections (respecting headings)
 * @param markdown - Markdown content
 * @param atomicRanges - Ranges occupied by atomic elements (to skip)
 * @param maxChunkSize - Maximum chunk size in characters
 * @returns Array of text chunk nodes
 */
function chunkTextContent(
  markdown: string,
  atomicRanges: Array<{ start: number; end: number }>,
  maxChunkSize: number = 1500
): ParsedNode[] {
  const lines = markdown.split('\n');
  const nodes: ParsedNode[] = [];
  
  let currentChunk: string[] = [];
  let currentHeadings = { h1: '', h2: '', h3: '' };
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    // Skip lines that are part of atomic elements
    const inAtomicRange = atomicRanges.some(range => i >= range.start && i < range.end);
    if (inAtomicRange) continue;

    const line = lines[i];
    
    // Update heading hierarchy
    if (line.startsWith('# ')) {
      currentHeadings = { h1: line.replace(/^#\s+/, ''), h2: '', h3: '' };
    } else if (line.startsWith('## ')) {
      currentHeadings.h2 = line.replace(/^##\s+/, '');
      currentHeadings.h3 = '';
    } else if (line.startsWith('### ')) {
      currentHeadings.h3 = line.replace(/^###\s+/, '');
    }

    currentChunk.push(line);

    const chunkText = currentChunk.join('\n');
    if (chunkText.length >= maxChunkSize) {
      // Flush current chunk
      nodes.push({
        chunk_index: chunkIndex++,
        content: chunkText.trim(),
        chunk_type: 'text',
        is_atomic: false,
        heading_hierarchy: { ...currentHeadings },
      });
      currentChunk = [];
    }
  }

  // Flush remaining chunk
  if (currentChunk.length > 0) {
    nodes.push({
      chunk_index: chunkIndex++,
      content: currentChunk.join('\n').trim(),
      chunk_type: 'text',
      is_atomic: false,
      heading_hierarchy: { ...currentHeadings },
    });
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

  // Step 1: Extract atomic elements (tables, code blocks) with summaries
  const atomicNodes = await extractAtomicElements(markdown, lovableApiKey);
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

  // Step 5: Create objects map for recursive retrieval
  const objectsMap = new Map<string, ParsedNode>();
  atomicNodes.forEach(node => {
    objectsMap.set(node.chunk_index.toString(), node);
  });

  console.log(`[MarkdownParser] Parsing complete: ${allNodes.length} total nodes`);

  return {
    baseNodes: allNodes,
    objectsMap,
  };
}
