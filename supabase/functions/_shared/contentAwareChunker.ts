/**
 * Content-Aware Chunking for Pipeline C
 * Implementa semantic boundary detection e adaptive sizing
 */

interface ChunkingConfig {
  maxChunkSize: number;
  minChunkSize: number;
  overlapSize: number;
  respectBoundaries: boolean;
  adaptiveSizing: boolean;
}

interface SemanticChunk {
  content: string;
  chunk_index: number;
  chunk_type: 'narrative' | 'technical' | 'reference';
  semantic_weight: number;
  position: 'intro' | 'body' | 'conclusion';
  headings: string[];
  document_section: string;
  page_number?: number;
  metadata: {
    boundaryRespected: boolean;
    originalSize: number;
    adaptedSize: number;
  };
}

interface DocumentStructure {
  headings: Array<{ level: number; text: string; position: number }>;
  paragraphs: Array<{ text: string; start: number; end: number }>;
  codeBlocks: Array<{ content: string; start: number; end: number }>;
  lists: Array<{ items: string[]; start: number; end: number }>;
  tables: Array<{ content: string; start: number; end: number }>;
}

export class SemanticBoundaryChunker {
  private config: ChunkingConfig;
  
  constructor(config?: Partial<ChunkingConfig>) {
    this.config = {
      maxChunkSize: config?.maxChunkSize ?? 1500,
      minChunkSize: config?.minChunkSize ?? 200,
      overlapSize: config?.overlapSize ?? 100,
      respectBoundaries: config?.respectBoundaries ?? true,
      adaptiveSizing: config?.adaptiveSizing ?? true,
    };
  }
  
  /**
   * Chunk principale: prende testo e restituisce chunk semantici
   */
  public chunk(text: string, pageNumber?: number): SemanticChunk[] {
    // Analizza struttura documento
    const structure = this.analyzeDocumentStructure(text);
    
    // Determina boundaries semantici
    const boundaries = this.identifySemanticBoundaries(text, structure);
    
    // Crea chunk rispettando boundaries
    const rawChunks = this.createChunksRespectingBoundaries(text, boundaries);
    
    // Arricchisci con metadata
    return rawChunks.map((chunk, index) => 
      this.enrichChunk(chunk, index, text, structure, pageNumber)
    );
  }
  
  /**
   * Analizza struttura del documento
   */
  private analyzeDocumentStructure(text: string): DocumentStructure {
    return {
      headings: this.detectHeadings(text),
      paragraphs: this.detectParagraphs(text),
      codeBlocks: this.detectCodeBlocks(text),
      lists: this.detectLists(text),
      tables: this.detectTables(text),
    };
  }
  
  /**
   * Rileva headings (Markdown-style)
   */
  private detectHeadings(text: string): Array<{ level: number; text: string; position: number }> {
    const headingPattern = /^(#{1,6})\s+(.+)$/gm;
    const headings: Array<{ level: number; text: string; position: number }> = [];
    
    let match;
    while ((match = headingPattern.exec(text)) !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        position: match.index,
      });
    }
    
    return headings;
  }
  
  /**
   * Rileva paragrafi (separati da doppio newline)
   */
  private detectParagraphs(text: string): Array<{ text: string; start: number; end: number }> {
    const paragraphs: Array<{ text: string; start: number; end: number }> = [];
    const parts = text.split(/\n\n+/);
    
    let currentPos = 0;
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        const start = text.indexOf(trimmed, currentPos);
        paragraphs.push({
          text: trimmed,
          start,
          end: start + trimmed.length,
        });
        currentPos = start + trimmed.length;
      }
    }
    
    return paragraphs;
  }
  
  /**
   * Rileva code blocks (Markdown-style)
   */
  private detectCodeBlocks(text: string): Array<{ content: string; start: number; end: number }> {
    const codePattern = /```[\s\S]*?```/g;
    const blocks: Array<{ content: string; start: number; end: number }> = [];
    
    let match;
    while ((match = codePattern.exec(text)) !== null) {
      blocks.push({
        content: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    
    return blocks;
  }
  
  /**
   * Rileva liste (Markdown-style)
   */
  private detectLists(text: string): Array<{ items: string[]; start: number; end: number }> {
    const listPattern = /^[\s]*[-*+]\s+.+(?:\n[\s]*[-*+]\s+.+)*/gm;
    const lists: Array<{ items: string[]; start: number; end: number }> = [];
    
    let match;
    while ((match = listPattern.exec(text)) !== null) {
      const items = match[0]
        .split('\n')
        .map(line => line.replace(/^[\s]*[-*+]\s+/, '').trim())
        .filter(item => item.length > 0);
      
      lists.push({
        items,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    
    return lists;
  }
  
  /**
   * Rileva tabelle (Markdown-style)
   */
  private detectTables(text: string): Array<{ content: string; start: number; end: number }> {
    const tablePattern = /\|.+\|(?:\n\|[-:|\s]+\|)?(?:\n\|.+\|)*/g;
    const tables: Array<{ content: string; start: number; end: number }> = [];
    
    let match;
    while ((match = tablePattern.exec(text)) !== null) {
      tables.push({
        content: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    
    return tables;
  }
  
  /**
   * Identifica boundaries semantici nel testo
   */
  private identifySemanticBoundaries(text: string, structure: DocumentStructure): number[] {
    const boundaries = new Set<number>([0, text.length]);
    
    // Aggiungi boundaries da headings
    structure.headings.forEach(h => boundaries.add(h.position));
    
    // Aggiungi boundaries da paragrafi
    structure.paragraphs.forEach(p => {
      boundaries.add(p.start);
      boundaries.add(p.end);
    });
    
    // Aggiungi boundaries da code blocks
    structure.codeBlocks.forEach(cb => {
      boundaries.add(cb.start);
      boundaries.add(cb.end);
    });
    
    return Array.from(boundaries).sort((a, b) => a - b);
  }
  
  /**
   * Crea chunk rispettando boundaries semantici
   */
  private createChunksRespectingBoundaries(text: string, boundaries: number[]): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    let currentStart = 0;
    
    for (let i = 1; i < boundaries.length; i++) {
      const segmentStart = boundaries[i - 1];
      const segmentEnd = boundaries[i];
      const segment = text.substring(segmentStart, segmentEnd).trim();
      
      if (!segment) continue;
      
      // Se aggiungere questo segment supera maxChunkSize, salva chunk corrente
      if (currentChunk.length + segment.length > this.config.maxChunkSize && currentChunk.length >= this.config.minChunkSize) {
        chunks.push(currentChunk.trim());
        
        // Overlap: prendi ultime N parole del chunk precedente
        const words = currentChunk.split(/\s+/);
        const overlapWords = words.slice(-Math.floor(this.config.overlapSize / 5));
        currentChunk = overlapWords.join(' ') + ' ';
      }
      
      currentChunk += segment + ' ';
    }
    
    // Aggiungi ultimo chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
  
  /**
   * Arricchisce chunk con metadata
   */
  private enrichChunk(
    content: string,
    index: number,
    fullText: string,
    structure: DocumentStructure,
    pageNumber?: number
  ): SemanticChunk {
    const chunkType = this.determineChunkType(content);
    const semanticWeight = this.calculateSemanticWeight(content);
    const position = this.determinePosition(index, fullText);
    const headings = this.extractRelevantHeadings(content, structure);
    
    return {
      content,
      chunk_index: index,
      chunk_type: chunkType,
      semantic_weight: semanticWeight,
      position,
      headings,
      document_section: headings[0] || 'Unknown Section',
      page_number: pageNumber,
      metadata: {
        boundaryRespected: true,
        originalSize: content.length,
        adaptedSize: content.length,
      },
    };
  }
  
  /**
   * Determina tipo di chunk (narrative, technical, reference)
   */
  private determineChunkType(content: string): 'narrative' | 'technical' | 'reference' {
    const codeBlockRatio = (content.match(/```/g) || []).length / content.length;
    const listItemRatio = (content.match(/^[-*]\s/gm) || []).length / content.split('\n').length;
    
    if (codeBlockRatio > 0.1 || content.includes('function') || content.includes('class')) {
      return 'technical';
    }
    
    if (listItemRatio > 0.3 || content.includes('|') || content.match(/^\d+\./gm)) {
      return 'reference';
    }
    
    return 'narrative';
  }
  
  /**
   * Calcola peso semantico (0-1)
   */
  private calculateSemanticWeight(content: string): number {
    const technicalTerms = this.countTechnicalTerms(content);
    const conceptDensity = this.analyzeConceptDensity(content);
    const informationDensity = content.split(/\s+/).length / content.length;
    
    return Math.min(1, (technicalTerms * 0.4) + (conceptDensity * 0.4) + (informationDensity * 0.2));
  }
  
  /**
   * Conta termini tecnici
   */
  private countTechnicalTerms(content: string): number {
    const technicalPatterns = [
      /\b(function|class|interface|type|const|let|var|import|export)\b/gi,
      /\b(algorithm|data structure|complexity|optimization)\b/gi,
      /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g, // CamelCase
    ];
    
    let count = 0;
    technicalPatterns.forEach(pattern => {
      count += (content.match(pattern) || []).length;
    });
    
    return Math.min(1, count / 10);
  }
  
  /**
   * Analizza densità concettuale
   */
  private analyzeConceptDensity(content: string): number {
    const words = content.split(/\s+/);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    
    return uniqueWords.size / words.length;
  }
  
  /**
   * Determina posizione nel documento
   */
  private determinePosition(index: number, fullText: string): 'intro' | 'body' | 'conclusion' {
    const totalLength = fullText.length;
    const currentPos = index * this.config.maxChunkSize;
    
    if (currentPos < totalLength * 0.2) return 'intro';
    if (currentPos > totalLength * 0.8) return 'conclusion';
    return 'body';
  }
  
  /**
   * Estrae headings rilevanti per questo chunk
   */
  private extractRelevantHeadings(content: string, structure: DocumentStructure): string[] {
    // Trova headings che appaiono nel chunk o immediatamente prima
    const relevantHeadings = structure.headings
      .filter(h => content.includes(h.text))
      .map(h => h.text);
    
    return relevantHeadings.length > 0 ? relevantHeadings : ['No Section'];
  }
}
