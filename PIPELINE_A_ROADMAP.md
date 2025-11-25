# Pipeline A: LlamaParse + Small-to-Big Recursive Retrieval - Roadmap

## 🎯 Principio Fondamentale

> **"Separare ciò che viene cercato (Embedding/Search) da ciò che viene letto dall'LLM (Generation)"**

Questo significa:
- **Per le tabelle**: Embediamo il **riassunto** ("Tabella ricavi Q3"), ma restituiamo la **tabella originale Markdown**
- **Per i grafici**: LlamaParse in modalità multimodale li converte in descrizioni testuali
- **Il RecursiveRetriever** fa lo swap automatico: `summary_id → tabella_originale`

---

## 📊 Stato Implementazione

- **Fase 1**: Setup (DB, Storage, Secret) → ⏳ **Da fare**
- **Fase 2**: Shared Libraries (llamaParseClient.ts, markdownElementParser.ts, recursiveRetriever.ts) → ⏳ **Da fare**
- **Fase 3**: Edge Functions (4 funzioni) → ⏳ **Da fare**
- **Fase 4**: Integrazione RPC & UI → ⏳ **Da fare**

---

## 🏗 Architettura Small-to-Big Recursive Retrieval

### Workflow Visuale

```
[PDF Complesso] 
  ↓
[LlamaParse multimodal: vendor_multimodal_mode=true]
  ↓ (Markdown strutturato + descrizioni grafici)
[MarkdownElementNodeParser]
  ├── [Testo normale] → chunk diretto → embedding
  └── [Tabelle/Grafici] → LLM genera summary
                          ├── Embedding su summary
                          └── Raw Markdown preservato
  
[Query Utente] 
  ↓
[Semantic Search su embeddings]
  ↓ (Match su summary tabella)
[RecursiveRetriever: swap summary → raw content]
  ↓
[LLM riceve tabella Markdown completa]
  ↓
[Risposta accurata senza allucinazioni]
```

### Differenza Fondamentale vs Pipeline C

| Aspetto | Pipeline C | Pipeline A |
|---------|------------|------------|
| **Estrazione PDF** | Google Cloud Vision (testo grezzo) | LlamaParse (Markdown strutturato) |
| **Chunking** | SemanticBoundaryChunker (inferisce struttura) | MarkdownElementParser (usa segnali espliciti #, \|, ```) |
| **Tabelle** | Potenzialmente spezzate | MAI spezzate (is_atomic=true) + summary separato |
| **Headings** | Inferiti | Nativi nel Markdown |
| **Grafici** | OCR testo visibile | Descrizione multimodale GPT-4o/Gemini |
| **Retrieval** | Diretto su chunk | Recursive: summary → original content |

---

## 💾 Database Schema

### 1. `pipeline_a_documents`

```sql
CREATE TABLE pipeline_a_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_bucket TEXT DEFAULT 'pipeline-a-uploads',
  file_size_bytes INTEGER,
  
  -- Status: ingested → processing → chunked → ready → failed
  status TEXT DEFAULT 'ingested' CHECK (status IN ('ingested', 'processing', 'chunked', 'ready', 'failed')),
  
  -- Job ID restituito da LlamaParse (per caching)
  llamaparse_job_id TEXT,
  
  page_count INTEGER,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_pipeline_a_documents_status ON pipeline_a_documents(status);
CREATE INDEX idx_pipeline_a_documents_llamaparse_job ON pipeline_a_documents(llamaparse_job_id);
```

### 2. `pipeline_a_chunks_raw` (CORE INNOVATION)

```sql
CREATE TABLE pipeline_a_chunks_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES pipeline_a_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  
  -- Contenuto per embedding (può essere summary per tabelle/grafici)
  content TEXT NOT NULL,
  
  -- Contenuto originale (per tabelle: raw Markdown completo)
  -- Questo è ciò che l'LLM riceverà per la generazione
  original_content TEXT,
  
  -- Summary generato dall'LLM helper (per tabelle/grafici)
  summary TEXT,
  
  -- Tipo: 'text', 'table', 'code_block', 'image_description'
  chunk_type TEXT,
  
  -- Flag: se true, non va mai spezzato (tabelle, code blocks)
  is_atomic BOOLEAN DEFAULT false,
  
  -- ID del nodo padre per mapping recursive (summary → original)
  parent_node_id UUID,
  
  -- Heading hierarchy: {"h1": "Chapter 1", "h2": "Section A", "h3": "Subsection"}
  heading_hierarchy JSONB,
  
  page_number INTEGER,
  
  -- Vector embedding
  embedding VECTOR(1536),
  embedding_status TEXT DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'ready', 'failed')),
  embedded_at TIMESTAMPTZ,
  embedding_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pipeline_a_chunks_document ON pipeline_a_chunks_raw(document_id);
CREATE INDEX idx_pipeline_a_chunks_embedding_status ON pipeline_a_chunks_raw(embedding_status);
CREATE INDEX idx_pipeline_a_chunks_type ON pipeline_a_chunks_raw(chunk_type);
CREATE INDEX idx_pipeline_a_chunks_parent ON pipeline_a_chunks_raw(parent_node_id);

-- Vector index for similarity search
CREATE INDEX idx_pipeline_a_chunks_embedding ON pipeline_a_chunks_raw 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 3. `pipeline_a_agent_knowledge`

```sql
CREATE TABLE pipeline_a_agent_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chunk_id UUID REFERENCES pipeline_a_chunks_raw(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, chunk_id)
);

CREATE INDEX idx_pipeline_a_agent_knowledge_agent ON pipeline_a_agent_knowledge(agent_id);
CREATE INDEX idx_pipeline_a_agent_knowledge_chunk ON pipeline_a_agent_knowledge(chunk_id);
```

### 4. Storage Bucket

```sql
INSERT INTO storage.buckets (id, name, public) 
VALUES ('pipeline-a-uploads', 'pipeline-a-uploads', true);
```

### 5. RLS Policies

```sql
-- pipeline_a_documents
ALTER TABLE pipeline_a_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on pipeline_a_documents" ON pipeline_a_documents FOR ALL USING (true);

-- pipeline_a_chunks_raw
ALTER TABLE pipeline_a_chunks_raw ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on pipeline_a_chunks_raw" ON pipeline_a_chunks_raw FOR ALL USING (true);

-- pipeline_a_agent_knowledge
ALTER TABLE pipeline_a_agent_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on pipeline_a_agent_knowledge" ON pipeline_a_agent_knowledge FOR ALL USING (true);
```

---

## 📚 Shared Libraries

### 1. `_shared/llamaParseClient.ts`

```typescript
/**
 * LlamaParse API Client for Pipeline A
 * Converte PDF → Markdown strutturato con descrizione grafici
 */

const LLAMAPARSE_API_BASE = 'https://api.cloud.llamaindex.ai/api/v1/parsing';

interface LlamaParseJob {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  error?: string;
}

interface LlamaParseConfig {
  vendor_multimodal_mode: boolean;
  result_type: 'markdown';
  language: string;
}

/**
 * Upload PDF a LlamaParse e ottieni job_id
 */
export async function uploadToLlamaParse(
  pdfBuffer: ArrayBuffer,
  fileName: string,
  apiKey: string,
  config: LlamaParseConfig = {
    vendor_multimodal_mode: true, // ← Descrive grafici con GPT-4o/Gemini
    result_type: 'markdown',
    language: 'it',
  }
): Promise<string> {
  const formData = new FormData();
  formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), fileName);
  
  // Aggiungi configurazione
  Object.entries(config).forEach(([key, value]) => {
    formData.append(key, String(value));
  });
  
  const response = await fetch(`${LLAMAPARSE_API_BASE}/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });
  
  if (!response.ok) {
    throw new Error(`LlamaParse upload failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.id; // job_id
}

/**
 * Poll status fino a completamento o timeout
 */
export async function pollJobUntilComplete(
  jobId: string,
  apiKey: string,
  maxWaitMs: number = 300000 // 5 minuti
): Promise<LlamaParseJob> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(`${LLAMAPARSE_API_BASE}/job/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    
    if (!response.ok) {
      throw new Error(`LlamaParse job status check failed: ${response.statusText}`);
    }
    
    const job: LlamaParseJob = await response.json();
    
    if (job.status === 'SUCCESS') return job;
    if (job.status === 'ERROR') throw new Error(`LlamaParse job failed: ${job.error}`);
    
    // Wait 2 seconds before next poll
    await new Promise(r => setTimeout(r, 2000));
  }
  
  throw new Error('LlamaParse job timeout after 5 minutes');
}

/**
 * Ottieni risultato Markdown dal job completato
 */
export async function getMarkdownResult(
  jobId: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(`${LLAMAPARSE_API_BASE}/job/${jobId}/result/markdown`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  
  if (!response.ok) {
    throw new Error(`LlamaParse result fetch failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.markdown; // Markdown strutturato con grafici descritti
}

/**
 * Funzione combo: Upload → Poll → Get Result
 */
export async function extractMarkdownFromPDF(
  pdfBuffer: ArrayBuffer,
  fileName: string,
  apiKey: string
): Promise<{ markdown: string; jobId: string; pageCount: number }> {
  const jobId = await uploadToLlamaParse(pdfBuffer, fileName, apiKey);
  await pollJobUntilComplete(jobId, apiKey);
  const markdown = await getMarkdownResult(jobId, apiKey);
  
  // Conta pagine dal Markdown (approssimazione)
  const pageCount = (markdown.match(/\n---\n/g) || []).length + 1;
  
  return { markdown, jobId, pageCount };
}

/**
 * Helper: conta pagine nel Markdown
 */
function countPagesInMarkdown(markdown: string): number {
  // LlamaParse spesso inserisce --- come separatore pagina
  const pageSeparators = (markdown.match(/\n---\n/g) || []).length;
  return Math.max(pageSeparators + 1, 1);
}
```

### 2. `_shared/markdownElementParser.ts` (CORE INNOVATION)

```typescript
/**
 * Markdown Element Parser for Pipeline A
 * Estrae elementi strutturati (testo, tabelle, code blocks, headings)
 * Genera summary per elementi atomici (tabelle)
 */

interface ParsedNode {
  id: string;
  type: 'text' | 'table' | 'code_block' | 'image' | 'heading';
  content: string;           // Per embedding (può essere summary)
  original_content?: string; // Markdown originale (per tabelle/code)
  summary?: string;          // Summary generato da LLM (per tabelle)
  heading_hierarchy: Record<string, string>;
  is_atomic: boolean;        // true per tabelle/code blocks
  chunk_index: number;
  page_number?: number;
}

interface LLMHelper {
  summarize: (content: string) => Promise<string>;
}

interface ParserResult {
  baseNodes: ParsedNode[];
  objectsMap: Map<string, string>; // summary_id → original_content_id
}

/**
 * Parse Markdown in elementi strutturati
 */
export async function parseMarkdownElements(
  markdown: string,
  llmHelper: LLMHelper
): Promise<ParserResult> {
  const nodes: ParsedNode[] = [];
  const objectsMap = new Map<string, string>();
  
  // 1. Identifica elementi atomici (tabelle, code blocks)
  const atomicElements = identifyAtomicElements(markdown);
  
  // 2. Splitta per headers mantenendo gerarchia
  const sections = splitBySections(markdown);
  
  let currentHierarchy: Record<string, string> = {};
  let chunkIndex = 0;
  
  for (const section of sections) {
    // Aggiorna heading hierarchy
    currentHierarchy = updateHeadingHierarchy(section, currentHierarchy);
    
    // Verifica se sezione contiene elementi atomici
    const containsAtomic = atomicElements.some(el => 
      section.start <= el.start && el.end <= section.end
    );
    
    if (containsAtomic) {
      // Estrai elementi atomici (tabelle, code blocks)
      const atomicNodes = await extractAtomicElements(
        section.content,
        atomicElements.filter(el => section.start <= el.start && el.end <= section.end),
        currentHierarchy,
        llmHelper,
        chunkIndex
      );
      
      nodes.push(...atomicNodes);
      chunkIndex += atomicNodes.length;
      
      // Mappa summary → original per recursive retrieval
      atomicNodes.forEach(node => {
        if (node.summary && node.original_content) {
          const summaryNodeId = `${node.id}_summary`;
          objectsMap.set(summaryNodeId, node.id);
        }
      });
    } else {
      // Chunking normale per testo
      const textNodes = chunkTextContent(
        section.content,
        currentHierarchy,
        chunkIndex
      );
      nodes.push(...textNodes);
      chunkIndex += textNodes.length;
    }
  }
  
  return { baseNodes: nodes, objectsMap };
}

/**
 * Identifica tabelle e code blocks (elementi atomici)
 */
function identifyAtomicElements(markdown: string): Array<{
  type: 'table' | 'code_block';
  start: number;
  end: number;
  content: string;
}> {
  const elements: Array<{ type: 'table' | 'code_block'; start: number; end: number; content: string }> = [];
  
  // Rileva code blocks (```...```)
  const codePattern = /```[\s\S]*?```/g;
  let match;
  while ((match = codePattern.exec(markdown)) !== null) {
    elements.push({
      type: 'code_block',
      start: match.index,
      end: match.index + match[0].length,
      content: match[0],
    });
  }
  
  // Rileva tabelle (righe che iniziano e finiscono con |)
  const tablePattern = /(?:^\|.+\|$\n?)+/gm;
  while ((match = tablePattern.exec(markdown)) !== null) {
    elements.push({
      type: 'table',
      start: match.index,
      end: match.index + match[0].length,
      content: match[0],
    });
  }
  
  return elements.sort((a, b) => a.start - b.start);
}

/**
 * Estrai e processa elementi atomici (tabelle → summary)
 */
async function extractAtomicElements(
  sectionContent: string,
  atomicElements: Array<{ type: 'table' | 'code_block'; start: number; end: number; content: string }>,
  headingHierarchy: Record<string, string>,
  llmHelper: LLMHelper,
  startIndex: number
): Promise<ParsedNode[]> {
  const nodes: ParsedNode[] = [];
  
  for (let i = 0; i < atomicElements.length; i++) {
    const element = atomicElements[i];
    const nodeId = crypto.randomUUID();
    
    if (element.type === 'table') {
      // Per le tabelle: genera summary con LLM
      const summary = await llmHelper.summarize(element.content);
      
      nodes.push({
        id: nodeId,
        type: 'table',
        content: summary,              // ← Embedding sul summary
        original_content: element.content, // ← Tabella Markdown originale
        summary,
        heading_hierarchy: headingHierarchy,
        is_atomic: true,
        chunk_index: startIndex + i,
      });
    } else if (element.type === 'code_block') {
      // Code blocks: mantieni intero, no summary
      nodes.push({
        id: nodeId,
        type: 'code_block',
        content: element.content,
        original_content: element.content,
        heading_hierarchy: headingHierarchy,
        is_atomic: true,
        chunk_index: startIndex + i,
      });
    }
  }
  
  return nodes;
}

/**
 * Chunk testo normale (con overlap)
 */
function chunkTextContent(
  text: string,
  headingHierarchy: Record<string, string>,
  startIndex: number,
  maxChunkSize: number = 1500,
  overlapTokens: number = 75
): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  let currentChunk = '';
  let chunkIndex = startIndex;
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
      // Salva chunk corrente
      nodes.push({
        id: crypto.randomUUID(),
        type: 'text',
        content: currentChunk.trim(),
        heading_hierarchy: headingHierarchy,
        is_atomic: false,
        chunk_index: chunkIndex++,
      });
      
      // Overlap: mantieni ultime N parole
      const words = currentChunk.trim().split(/\s+/);
      const overlapWords = words.slice(-overlapTokens);
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }
  
  // Ultimo chunk
  if (currentChunk.trim().length > 0) {
    nodes.push({
      id: crypto.randomUUID(),
      type: 'text',
      content: currentChunk.trim(),
      heading_hierarchy: headingHierarchy,
      is_atomic: false,
      chunk_index: chunkIndex,
    });
  }
  
  return nodes;
}

/**
 * Split Markdown per sezioni basate su headers
 */
function splitBySections(markdown: string): Array<{
  content: string;
  start: number;
  end: number;
  level?: number;
}> {
  const sections: Array<{ content: string; start: number; end: number; level?: number }> = [];
  const lines = markdown.split('\n');
  
  let currentSection = { content: '', start: 0, end: 0 };
  let position = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headerMatch && currentSection.content) {
      // Salva sezione corrente
      currentSection.end = position;
      sections.push(currentSection);
      
      // Inizia nuova sezione
      currentSection = { content: line + '\n', start: position, end: 0 };
    } else {
      currentSection.content += line + '\n';
    }
    
    position += line.length + 1; // +1 per \n
  }
  
  // Ultima sezione
  if (currentSection.content) {
    currentSection.end = position;
    sections.push(currentSection);
  }
  
  return sections;
}

/**
 * Aggiorna heading hierarchy basandosi sul header corrente
 */
function updateHeadingHierarchy(
  section: { content: string },
  currentHierarchy: Record<string, string>
): Record<string, string> {
  const headerMatch = section.content.match(/^(#{1,6})\s+(.+)$/m);
  
  if (headerMatch) {
    const level = headerMatch[1].length;
    const title = headerMatch[2].trim();
    
    const newHierarchy = { ...currentHierarchy };
    newHierarchy[`h${level}`] = title;
    
    // Rimuovi livelli inferiori
    for (let i = level + 1; i <= 6; i++) {
      delete newHierarchy[`h${i}`];
    }
    
    return newHierarchy;
  }
  
  return currentHierarchy;
}
```

### 3. `_shared/recursiveRetriever.ts` (CORE INNOVATION)

```typescript
/**
 * Recursive Retriever per Pipeline A
 * Durante il retrieval: swap summary → original content
 */

interface SearchResult {
  chunk_id: string;
  content: string;
  similarity: number;
  is_atomic: boolean;
  original_content?: string;
  chunk_type: string;
}

interface EnrichedResult {
  chunk_id: string;
  content_for_llm: string; // ← Contenuto da passare all'LLM
  searched_content: string; // ← Contenuto su cui è stato fatto embedding
  similarity: number;
  chunk_type: string;
}

/**
 * Swap summary con original content per elementi atomici
 */
export function swapSummaryWithOriginal(
  searchResults: SearchResult[],
  objectsMap: Map<string, string>
): EnrichedResult[] {
  return searchResults.map(result => {
    // Se è elemento atomico con original_content, usa quello per l'LLM
    if (result.is_atomic && result.original_content) {
      return {
        chunk_id: result.chunk_id,
        content_for_llm: result.original_content, // ← Tabella Markdown completa
        searched_content: result.content,         // ← Summary embedatto
        similarity: result.similarity,
        chunk_type: result.chunk_type,
      };
    }
    
    // Testo normale: nessuno swap
    return {
      chunk_id: result.chunk_id,
      content_for_llm: result.content,
      searched_content: result.content,
      similarity: result.similarity,
      chunk_type: result.chunk_type,
    };
  });
}

/**
 * Recupera nodi padre per elementi child (se necessario)
 */
export async function fetchParentNodes(
  chunkIds: string[],
  supabase: any
): Promise<Map<string, string>> {
  const { data: chunks } = await supabase
    .from('pipeline_a_chunks_raw')
    .select('id, parent_node_id, original_content')
    .in('id', chunkIds);
  
  const parentMap = new Map<string, string>();
  
  chunks?.forEach((chunk: any) => {
    if (chunk.parent_node_id && chunk.original_content) {
      parentMap.set(chunk.id, chunk.original_content);
    }
  });
  
  return parentMap;
}
```

---

## ⚡ Edge Functions

### 1. `pipeline-a-ingest-pdf`

Clone esatto di `pipeline-c-ingest-pdf` con questi cambiamenti:
- Bucket: `pipeline-a-uploads`
- Tabella: `pipeline_a_documents`
- Trigger: `pipeline-a-process-chunks`

```typescript
// Dopo upload a storage
const { data: newDoc } = await supabase
  .from('pipeline_a_documents')
  .insert({
    file_name: fileName,
    file_path: filePath,
    storage_bucket: 'pipeline-a-uploads',
    file_size_bytes: fileData.length,
    status: 'ingested',
  })
  .select()
  .single();

// Event-driven: trigger processing
EdgeRuntime.waitUntil(
  supabase.functions.invoke('pipeline-a-process-chunks', {
    body: { documentId: newDoc.id },
  })
);
```

### 2. `pipeline-a-process-chunks` (CORE INNOVATION)

**Differenze chiave rispetto a Pipeline C:**

```typescript
// Pipeline C (VECCHIO):
const extractionResult = await extractTextFromPDF(arrayBuffer, {
  googleCloudVisionApiKey,
});
const semanticChunks = chunker.chunk(extractionResult.fullText);

// Pipeline A (NUOVO):
const LLAMA_API_KEY = Deno.env.get('LLAMA_CLOUD_API_KEY');
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

// 1. Estrai Markdown strutturato con LlamaParse
const { markdown, jobId, pageCount } = await extractMarkdownFromPDF(
  arrayBuffer,
  doc.file_name,
  LLAMA_API_KEY
);

// 2. Parse elementi strutturati con LLM helper per summary tabelle
const llmHelper = {
  summarize: async (tableContent: string) => {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash', // Veloce + economico
        messages: [{
          role: 'user',
          content: `Riassumi in una frase il contenuto di questa tabella Markdown:\n\n${tableContent}`,
        }],
      }),
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
  },
};

const { baseNodes, objectsMap } = await parseMarkdownElements(markdown, llmHelper);

// 3. Salva chunks con original_content e summary
const chunksToInsert = baseNodes.map(node => ({
  document_id: doc.id,
  chunk_index: node.chunk_index,
  content: node.content,              // Summary per tabelle, testo per altri
  original_content: node.original_content, // Markdown originale
  summary: node.summary,               // Summary LLM (solo tabelle)
  chunk_type: node.type,
  is_atomic: node.is_atomic,
  heading_hierarchy: node.heading_hierarchy,
  embedding_status: 'pending',
}));

await supabase.from('pipeline_a_chunks_raw').insert(chunksToInsert);

// 4. Salva llamaparse_job_id per future reference
await supabase
  .from('pipeline_a_documents')
  .update({ 
    llamaparse_job_id: jobId,
    page_count: pageCount,
    status: 'chunked',
  })
  .eq('id', doc.id);

// 5. Event-driven: trigger embedding generation
EdgeRuntime.waitUntil(
  supabase.functions.invoke('pipeline-a-generate-embeddings', {
    body: { documentId: doc.id },
  })
);
```

### 3. `pipeline-a-generate-embeddings`

Clone esatto di `pipeline-c-generate-embeddings` con cambiamenti:
- Tabella: `pipeline_a_chunks_raw`
- Genera embedding su `content` (che per tabelle è il summary)

```typescript
// Query chunks pending
const { data: chunks } = await supabase
  .from('pipeline_a_chunks_raw')
  .select('id, content, document_id')
  .eq('embedding_status', 'pending')
  .limit(batchSize);

// Genera embeddings (su summary per tabelle, su testo per altri)
const embeddings = await generateEmbeddings(chunks.map(c => c.content));

// Update con embeddings
for (let i = 0; i < chunks.length; i++) {
  await supabase
    .from('pipeline_a_chunks_raw')
    .update({
      embedding: JSON.stringify(embeddings[i]),
      embedding_status: 'ready',
      embedded_at: new Date().toISOString(),
    })
    .eq('id', chunks[i].id);
}

// Auto-update document status to 'ready'
// (stesso pattern Pipeline B/C)
```

### 4. `pipeline-a-sync-agent`

Clone esatto di `pipeline-c-sync-agent` con cambiamenti:
- Tabelle: `pipeline_a_chunks_raw`, `pipeline_a_agent_knowledge`

```typescript
const { data: readyChunks } = await supabase
  .from('pipeline_a_chunks_raw')
  .select('id, document_id')
  .eq('document_id', documentId)
  .eq('embedding_status', 'ready');

await supabase.from('pipeline_a_agent_knowledge').upsert(
  readyChunks.map(chunk => ({
    agent_id: agentId,
    chunk_id: chunk.id,
    is_active: true,
  }))
);
```

---

## 🔍 Integrazione RPC: Recursive Retrieval

### Modifica `match_documents` RPC

**Aggiunta critica per Pipeline A:**

```sql
UNION ALL

-- Pipeline A documents (Small-to-Big Recursive Retrieval)
SELECT 
  pacr.id,
  pacr.document_id AS pool_document_id,
  pad.file_name AS document_name,
  
  -- ← CORE INNOVATION: Swap summary → original content
  CASE 
    WHEN pacr.is_atomic AND pacr.original_content IS NOT NULL 
    THEN pacr.original_content  -- Tabella Markdown completa
    ELSE pacr.content           -- Testo normale
  END as content,  -- ← Questo va all'LLM
  
  pacr.chunk_type AS category,
  pacr.summary,  -- ← Metadata opzionale
  1 - (pacr.embedding <=> query_embedding) AS similarity
FROM pipeline_a_chunks_raw pacr
JOIN pipeline_a_agent_knowledge paak ON paak.chunk_id = pacr.id
JOIN pipeline_a_documents pad ON pad.id = pacr.document_id
WHERE pacr.embedding IS NOT NULL
  AND pacr.embedding_status = 'ready'
  AND paak.is_active = true
  AND 1 - (pacr.embedding <=> query_embedding) > match_threshold
  AND (filter_agent_id IS NULL OR paak.agent_id = filter_agent_id)

ORDER BY similarity DESC
LIMIT match_count;
```

**Spiegazione:**
- L'embedding viene fatto sul `summary` (per tabelle) o `content` (per testo)
- Il semantic search matcha sul summary
- Il RPC restituisce `original_content` (tabella completa) all'LLM
- **Risultato**: LLM riceve tabella intera, non summary spezzato

### Modifica `get_agent_sync_status` RPC

```sql
UNION ALL

-- Pipeline A documents
SELECT 
  pad.id as document_id,
  pad.file_name,
  COUNT(DISTINCT paak.chunk_id) as chunk_count,
  CASE 
    WHEN COUNT(paak.chunk_id) > 0 THEN 'completed'::text
    ELSE 'pending'::text
  END as sync_status,
  'pipeline_a'::text as pipeline_source
FROM pipeline_a_documents pad
LEFT JOIN pipeline_a_chunks_raw pacr ON pacr.document_id = pad.id
LEFT JOIN pipeline_a_agent_knowledge paak ON paak.chunk_id = pacr.id 
  AND paak.agent_id = p_agent_id
  AND paak.is_active = true
WHERE pad.status = 'ready'
  AND EXISTS (
    SELECT 1 FROM pipeline_a_agent_knowledge paak2
    JOIN pipeline_a_chunks_raw pacr2 ON pacr2.id = paak2.chunk_id
    WHERE pacr2.document_id = pad.id
      AND paak2.agent_id = p_agent_id
  )
GROUP BY pad.id, pad.file_name;
```

---

## 🎨 Integrazione UI

### 1. `DocumentPoolUpload.tsx`

```typescript
// Aggiungi opzione Pipeline A
const [selectedPipeline, setSelectedPipeline] = useState<'b' | 'c' | 'a'>('a');

<Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
  <SelectItem value="b">Pipeline B (Landing AI)</SelectItem>
  <SelectItem value="c">Pipeline C (Google Vision + Custom)</SelectItem>
  <SelectItem value="a">Pipeline A (LlamaParse + Recursive)</SelectItem>
</Select>

// Invoke corretto edge function
const functionName = selectedPipeline === 'a' 
  ? 'pipeline-a-ingest-pdf'
  : selectedPipeline === 'b'
  ? 'pipeline-b-ingest-pdf'
  : 'pipeline-c-ingest-pdf';
```

### 2. `DocumentPoolTable.tsx`

```typescript
// Query pipeline_a_documents
const { data: pipelineADocs } = await supabase
  .from('pipeline_a_documents')
  .select('*')
  .order('created_at', { ascending: false });

// Merge con altri pipelines
const allDocs = [
  ...legacyDocs.map(d => ({ ...d, pipeline: 'legacy' })),
  ...pipelineBDocs.map(d => ({ ...d, pipeline: 'b' })),
  ...pipelineCDocs.map(d => ({ ...d, pipeline: 'c' })),
  ...pipelineADocs.map(d => ({ ...d, pipeline: 'a' })),
];

// Badge per Pipeline A
{doc.pipeline === 'a' && (
  <Badge variant="outline" className="bg-purple-500/10 text-purple-700">
    Pipeline A
  </Badge>
)}
```

### 3. `BulkAssignDocumentDialog.tsx`

```typescript
// Includi pipeline_a_documents in query assignabili
const { data: pipelineADocs } = await supabase
  .from('pipeline_a_documents')
  .select('id')
  .eq('status', 'ready');

// Supporto assignment Pipeline A
if (doc.pipeline === 'a') {
  await supabase.functions.invoke('pipeline-a-sync-agent', {
    body: { agentId, documentId: doc.id },
  });
}
```

### 4. `assign-document-to-agent` Edge Function

```typescript
// Routing per pipeline='a'
if (pipeline === 'a') {
  const { error: syncError } = await supabase.functions.invoke('pipeline-a-sync-agent', {
    body: { agentId, documentId },
  });
  
  if (syncError) throw syncError;
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

---

## 📊 Quality Metrics Target

| Metrica | Target | Metodo Validazione |
|---------|--------|-------------------|
| **Table Integrity** | 100% | Tabelle MAI spezzate (is_atomic=true) |
| **Summary Quality** | >85% | Valutazione manuale su campione 50 tabelle |
| **Retrieval Precision@5** | >80% | Con recursive swap summary → original |
| **Hallucination Rate** | <10% | Test su query complesse con tabelle |
| **Heading Hierarchy Preservation** | >99% | Verifica metadata heading_hierarchy |
| **Multimodal Description Quality** | >75% | Descrizioni grafici comprensibili |

---

## 🔐 Prerequisiti

### 1. LLAMA_CLOUD_API_KEY
- Registrati su https://cloud.llamaindex.ai/
- Ottieni API Key gratuita
- Free tier: **1,000 pagine/giorno**

### 2. Lovable AI per Table Summarization
- Usa `google/gemini-2.5-flash` per riassunti tabelle
- Veloce + economico (~0.01$ per 1000 tabelle)
- `LOVABLE_API_KEY` già configurato

### 3. Configurazione LlamaParse

```typescript
{
  api_key: "llx-...",
  result_type: "markdown",
  language: "it",
  vendor_multimodal_mode: true,  // ← CRUCIALE per grafici
}
```

---

## 📅 Fasi Implementazione

### Fase 1: Setup (30 minuti) ⏳

- [ ] **Secret**: Aggiungi `LLAMA_CLOUD_API_KEY`
- [ ] **Storage**: Crea bucket `pipeline-a-uploads`
- [ ] **Database**: 
  - [ ] Crea `pipeline_a_documents`
  - [ ] Crea `pipeline_a_chunks_raw` (con original_content, summary, is_atomic)
  - [ ] Crea `pipeline_a_agent_knowledge`
  - [ ] RLS policies
  - [ ] Indexes

### Fase 2: Shared Libraries (2.5 ore) ⏳

- [ ] **`llamaParseClient.ts`**:
  - [ ] `uploadToLlamaParse()`
  - [ ] `pollJobUntilComplete()`
  - [ ] `getMarkdownResult()`
  - [ ] `extractMarkdownFromPDF()` combo
- [ ] **`markdownElementParser.ts`**:
  - [ ] `parseMarkdownElements()` main function
  - [ ] `identifyAtomicElements()`
  - [ ] `extractAtomicElements()` con LLM summarization
  - [ ] `chunkTextContent()` con overlap
  - [ ] `splitBySections()`
  - [ ] `updateHeadingHierarchy()`
- [ ] **`recursiveRetriever.ts`**:
  - [ ] `swapSummaryWithOriginal()`
  - [ ] `fetchParentNodes()`

### Fase 3: Edge Functions (2.5 ore) ⏳

- [ ] **`pipeline-a-ingest-pdf`**: Clone `pipeline-c-ingest-pdf`
- [ ] **`pipeline-a-process-chunks`**: 
  - [ ] LlamaParse multimodal integration
  - [ ] MarkdownElementParser usage
  - [ ] LLM helper per table summarization
  - [ ] Salva original_content + summary
- [ ] **`pipeline-a-generate-embeddings`**: Clone `pipeline-c-generate-embeddings`
- [ ] **`pipeline-a-sync-agent`**: Clone `pipeline-c-sync-agent`
- [ ] **Cron jobs**: Configura schedule (10 min process, 5 min embed)

### Fase 4: Integrazione RPC & UI (2 ore) ⏳

- [ ] **RPC Functions**:
  - [ ] `match_documents`: UNION ALL con recursive swap
  - [ ] `get_agent_sync_status`: UNION ALL Pipeline A
- [ ] **UI Components**:
  - [ ] `DocumentPoolUpload`: Opzione Pipeline A
  - [ ] `DocumentPoolTable`: Query + display pipeline_a_documents
  - [ ] `BulkAssignDocumentDialog`: Supporto Pipeline A
  - [ ] `DocumentDetailsDialog`: Reprocessing Pipeline A
  - [ ] `DocumentPoolHealthIndicators`: Conteggi Pipeline A
  - [ ] `useDocumentAssignment`: Supporto `pipeline='a'`
  - [ ] `assign-document-to-agent`: Routing Pipeline A

### Fase 5: Testing & Validazione (1 ora) ⏳

- [ ] **Test Unit**:
  - [ ] `parseMarkdownElements()` su PDF sample
  - [ ] Verifica is_atomic=true per tabelle
  - [ ] Verifica summary generation
- [ ] **Test Integration**:
  - [ ] Upload PDF con tabelle
  - [ ] Verifica chunking preserva tabelle
  - [ ] Verifica recursive retrieval funziona
- [ ] **Test End-to-End**:
  - [ ] Assegna documento Pipeline A ad agente
  - [ ] Query su tabella
  - [ ] Verifica LLM riceve tabella completa

---

## 📈 Deployment Checklist

### Pre-Deploy
- [ ] Verifica `LLAMA_CLOUD_API_KEY` configurato
- [ ] Test shared libraries localmente
- [ ] Review schema database
- [ ] Backup database esistente

### Deploy
- [ ] Push migration database
- [ ] Deploy edge functions
- [ ] Verifica cron jobs attivi
- [ ] Test upload PDF sample

### Post-Deploy
- [ ] Monitor edge function logs
- [ ] Verifica document processing latency
- [ ] Test recursive retrieval con query reali
- [ ] Valuta quality metrics su campione documenti

---

## 🎯 Success Criteria

Pipeline A è considerata production-ready quando:

1. ✅ **Table Integrity**: 100% tabelle preservate intere
2. ✅ **Retrieval Accuracy**: >80% precision@5 con recursive swap
3. ✅ **Processing Speed**: <60 secondi per documento medio (20 pagine)
4. ✅ **Multimodal Support**: Grafici descritti correttamente (>75% quality)
5. ✅ **Zero Hallucinations**: LLM riceve sempre contenuto originale completo
6. ✅ **UI Integration**: Feature parity con Pipeline B/C

---

## 🚀 Vantaggi Pipeline A vs Pipeline C

| Aspetto | Pipeline C | Pipeline A |
|---------|------------|------------|
| **Parsing** | Google Cloud Vision (OCR-based) | LlamaParse (Markdown-native) |
| **Tabelle** | Riconosciute come testo, potenzialmente spezzate | Preservate come oggetti atomici 100% |
| **Grafici** | OCR testo visibile solo | Descrizione multimodale GPT-4o |
| **Chunking** | Inferisce struttura semantica | Usa segnali espliciti (headers, table markers) |
| **Retrieval** | Diretto su chunk | Recursive: summary → original (zero information loss) |
| **Cost** | $1.50 per 1000 pagine (Vision API) | $0.30 per 1000 pagine (LlamaParse) |
| **Speed** | ~45 secondi per doc | ~30 secondi per doc (parse più veloce) |

---

## 📚 Riferimenti

- **LlamaParse Docs**: https://docs.llamaindex.ai/en/stable/llama_cloud/llama_parse/
- **Recursive Retrieval Pattern**: https://docs.llamaindex.ai/en/stable/examples/retrievers/recursive_retriever_nodes/
- **Specifica Originale**: "Specifica Tecnica: Pipeline RAG Avanzata (LlamaParse + Recursive Retrieval)"

---

## 📝 Note Implementative

### Caching LlamaParse
Per evitare re-parsing dello stesso PDF (risparmiando crediti):

```typescript
// Prima di uploadToLlamaParse, verifica se esiste già job_id
const { data: existingDoc } = await supabase
  .from('pipeline_a_documents')
  .select('llamaparse_job_id')
  .eq('file_name', fileName)
  .eq('status', 'ready')
  .single();

if (existingDoc?.llamaparse_job_id) {
  // Riusa job esistente
  const markdown = await getMarkdownResult(existingDoc.llamaparse_job_id, apiKey);
  return { markdown, jobId: existingDoc.llamaparse_job_id, pageCount };
}
```

### Gestione Errori LLM Summarization
Se la summarization fallisce per una tabella:

```typescript
try {
  const summary = await llmHelper.summarize(tableContent);
} catch (error) {
  // Fallback: usa prime 100 parole della tabella
  const fallbackSummary = tableContent.substring(0, 500) + '...';
  console.warn(`Table summarization failed, using fallback: ${error}`);
  summary = fallbackSummary;
}
```

### Monitoring Table Integrity
Query per verificare che tutte le tabelle siano is_atomic=true:

```sql
SELECT COUNT(*) 
FROM pipeline_a_chunks_raw 
WHERE chunk_type = 'table' 
  AND is_atomic = false;
-- Deve restituire 0
```

---

**Totale Stima Implementazione: ~9 ore**

Pipeline A rappresenta lo stato dell'arte nel RAG per documenti complessi, eliminando il problema del "chunking piatto" e garantendo che l'LLM riceva sempre il contesto completo necessario per risposte accurate senza allucinazioni.
