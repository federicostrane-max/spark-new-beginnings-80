/**
 * Pipeline A-Hybrid Document Reconstructor
 * 
 * Implements hierarchical reading order algorithm to reconstruct linear "Super-Document"
 * from sparse LlamaParse JSON elements with bounding boxes.
 * 
 * Algorithm: Prioritize by (1) page_number, (2) Y-axis zones with tolerance for horizontal grouping,
 * (3) X-axis position for column ordering, (4) exact Y coordinate as tiebreaker.
 */

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LlamaParseElement {
  type: string;
  markdown?: string;
  bbox?: BoundingBox;
  page?: number;
  text?: string;
}

interface OrderedElement {
  content: string;
  type: string;
  page: number;
  y: number;
  x: number;
  bbox: BoundingBox;
  isAtomic: boolean;
}

const Y_ZONE_TOLERANCE = 20; // pixels tolerance for horizontal element grouping

/**
 * Extract vertical zone key for grouping horizontally adjacent elements
 */
function getVerticalZone(y: number): number {
  return Math.floor(y / Y_ZONE_TOLERANCE);
}

/**
 * Order document elements using hierarchical reading order algorithm
 */
export function orderElements(elements: LlamaParseElement[]): OrderedElement[] {
  const orderedElements: OrderedElement[] = [];

  for (const element of elements) {
    if (!element.bbox || element.page === undefined) {
      console.warn('[DocumentReconstructor] Skipping element without bbox or page:', element.type);
      continue;
    }

    const content = element.markdown || element.text || '';
    if (!content.trim()) {
      console.warn('[DocumentReconstructor] Skipping empty element:', element.type);
      continue;
    }

    const isAtomic = element.type === 'table' || element.type === 'code_block';

    orderedElements.push({
      content,
      type: element.type,
      page: element.page,
      y: element.bbox.y,
      x: element.bbox.x,
      bbox: element.bbox,
      isAtomic,
    });
  }

  // Hierarchical sorting: page → Y zone → X position → exact Y
  orderedElements.sort((a, b) => {
    // 1. Page number (ascending)
    if (a.page !== b.page) return a.page - b.page;

    // 2. Vertical zone (top to bottom)
    const zoneA = getVerticalZone(a.y);
    const zoneB = getVerticalZone(b.y);
    if (zoneA !== zoneB) return zoneA - zoneB;

    // 3. Horizontal position within zone (left to right)
    if (Math.abs(a.x - b.x) > 10) return a.x - b.x;

    // 4. Exact Y coordinate as tiebreaker
    return a.y - b.y;
  });

  console.log(`[DocumentReconstructor] Ordered ${orderedElements.length} elements using hierarchical algorithm`);
  return orderedElements;
}

/**
 * Build heading hierarchy map from ordered elements
 */
export function buildHeadingMap(orderedElements: OrderedElement[]): Map<number, any> {
  const headingMap = new Map<number, any>();
  const headingStack: { level: number; text: string }[] = [];

  orderedElements.forEach((element, index) => {
    const content = element.content;
    
    // Detect Markdown headings
    const headingMatch = content.match(/^(#{1,6})\s+(.+)$/m);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      // Pop headings of equal or deeper level
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      headingStack.push({ level, text });
    }

    // Record current hierarchy for this element
    if (headingStack.length > 0) {
      headingMap.set(index, [...headingStack]);
    }
  });

  return headingMap;
}

/**
 * Reconstruct linear "Super-Document" from ordered elements
 */
export function reconstructDocument(orderedElements: OrderedElement[]): string {
  const sections: string[] = [];
  let currentPage = -1;

  for (const element of orderedElements) {
    // Add page separator
    if (element.page !== currentPage) {
      if (currentPage !== -1) {
        sections.push('\n---\n');
      }
      sections.push(`# Page ${element.page}\n\n`);
      currentPage = element.page;
    }

    // Add element content with appropriate spacing
    sections.push(element.content.trim());
    sections.push('\n\n');
  }

  const superDocument = sections.join('');
  console.log(`[DocumentReconstructor] Reconstructed document: ${superDocument.length} characters`);
  
  return superDocument;
}

/**
 * Main reconstruction pipeline
 */
export function reconstructFromLlamaParse(jsonOutput: any): {
  superDocument: string;
  orderedElements: OrderedElement[];
  headingMap: Map<number, any>;
} {
  console.log('[DocumentReconstructor] Starting reconstruction from LlamaParse JSON');

  const elements = jsonOutput.items || [];
  console.log(`[DocumentReconstructor] Processing ${elements.length} elements`);

  const orderedElements = orderElements(elements);
  const headingMap = buildHeadingMap(orderedElements);
  const superDocument = reconstructDocument(orderedElements);

  console.log('[DocumentReconstructor] Reconstruction complete');
  
  return {
    superDocument,
    orderedElements,
    headingMap,
  };
}
