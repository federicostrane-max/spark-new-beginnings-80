# Pipeline C: Content-Aware RAG System - Roadmap

## Stato Implementazione

### ✅ Fase 1: Setup (Settimana 1)
- [ ] Database schema (pipeline_c_documents, pipeline_c_chunks_raw, pipeline_c_agent_knowledge)
- [ ] Shared library: contentAwareChunker.ts
- [ ] Shared library: pdfTextExtractor.ts
- [ ] Shared library: metadataEnricher.ts
- [ ] Shared library: chunkClassifier.ts

### ⏳ Fase 2: Core Functions (Settimana 2)
- [ ] Edge function: pipeline-c-ingest-pdf
- [ ] Edge function: pipeline-c-process-chunks (NUOVA IMPLEMENTAZIONE)
- [ ] Testing chunking logic
- [ ] Validation boundary respect

### ⏳ Fase 3: Embedding & Sync (Settimana 3)
- [ ] Edge function: pipeline-c-generate-embeddings
- [ ] Edge function: pipeline-c-sync-agent
- [ ] Cron job activation
- [ ] Status reconciliation logic

### ⏳ Fase 4: Validation (Settimana 4)
- [ ] A/B testing vs Pipeline B
- [ ] Quality metrics comparison
- [ ] Performance optimization
- [ ] Production readiness

---

## Architettura Pipeline C

### Obiettivo
Sistema RAG avanzato con Content-Aware Chunking completamente disaccoppiato da Pipeline A e B.

### 4 Stadi Indipendenti

#### Stage 1: Ingest
- **Edge Function**: `pipeline-c-ingest-pdf`
- **Input**: PDF file (base64)
- **Output**: Record in `pipeline_c_documents` con `status='ingested'`
- **Storage**: Bucket `pipeline-c-uploads`
- **Durata**: <1 secondo

#### Stage 2: Advanced Processing (CUSTOM)
- **Edge Function**: `pipeline-c-process-chunks` (cron ogni 10 min)
- **Sostituisce**: Landing AI parsing
- **Componenti Custom**:
  - PDF Text Extraction (pdfjs-dist)
  - Content-Aware Chunking (SemanticBoundaryChunker)
  - Advanced Metadata Enrichment
  - Type Detection & Classification

#### Stage 3: Embedding Generation
- **Edge Function**: `pipeline-c-generate-embeddings` (cron ogni 5 min)
- **Tecnologia**: OpenAI `text-embedding-3-small`
- **Output**: Chunks con embeddings + `embedding_status='ready'`

#### Stage 4: Agent Sync
- **Edge Function**: `pipeline-c-sync-agent`
- **Input**: `agent_id`, `document_id`
- **Output**: Links in `pipeline_c_agent_knowledge`

---

## Database Schema

### Tabella: pipeline_c_documents
```sql
CREATE TABLE pipeline_c_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'pipeline-c-uploads',
  file_size_bytes INTEGER,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'ingested',
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  error_message TEXT
);
```

### Tabella: pipeline_c_chunks_raw
```sql
CREATE TABLE pipeline_c_chunks_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pipeline_c_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  chunk_type TEXT NOT NULL, -- narrative, technical, reference
  semantic_weight NUMERIC, -- 0-1
  position TEXT, -- intro, body, conclusion
  headings JSONB, -- Array di heading hierarchy
  keywords TEXT[], -- Parole chiave estratte
  document_section TEXT,
  page_number INTEGER,
  visual_grounding JSONB, -- { left, top, right, bottom }
  embedding vector(1536),
  embedding_status TEXT DEFAULT 'pending',
  embedding_error TEXT,
  embedded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Tabella: pipeline_c_agent_knowledge
```sql
CREATE TABLE pipeline_c_agent_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES pipeline_c_chunks_raw(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, chunk_id)
);
```

---

## Shared Libraries

### 1. contentAwareChunker.ts
**Classe**: `SemanticBoundaryChunker`

**Metodi**:
- `analyzeDocumentStructure()`: Rileva paragrafi, headings, liste, code blocks
- `calculateSemanticWeight()`: Calcola densità informativa (0-1)
- `groupSemantically()`: Raggruppa testo rispettando semantic boundaries
- `createOptimalChunks()`: Genera chunk con metadata arricchiti

**Configurazione**:
```typescript
{
  maxChunkSize: 1500,
  minChunkSize: 200,
  overlapSize: 100,
  respectBoundaries: true,
  adaptiveSizing: true
}
```

### 2. pdfTextExtractor.ts
**Funzione**: `extractTextFromPDF()`

**Tecnologia**: `pdfjs-dist`

**Output**:
```typescript
{
  pages: Array<{
    pageNumber: number;
    text: string;
    items: Array<{ str: string; x: number; y: number }>;
  }>;
  metadata: {
    pageCount: number;
    title?: string;
    author?: string;
  };
}
```

### 3. metadataEnricher.ts
**Funzione**: `enrichChunkMetadata()`

**Output**:
```typescript
{
  chunk_type: 'narrative' | 'technical' | 'reference';
  semantic_weight: number;
  position: 'intro' | 'body' | 'conclusion';
  headings: string[];
  keywords: string[];
  document_section: string;
  page_number: number;
  visual_grounding?: { left, top, right, bottom };
}
```

### 4. chunkClassifier.ts
**Funzioni**:
- `detectSectionType()`: heading, paragraph, list, code, table
- `determineChunkType()`: narrative, technical, reference
- `detectTechnicalTerms()`: Analisi densità termini tecnici
- `analyzeConceptDensity()`: Complessità concettuale

---

## Edge Functions

### 1. pipeline-c-ingest-pdf
**Path**: `supabase/functions/pipeline-c-ingest-pdf/index.ts`

**Input**:
```typescript
{
  fileName: string;
  fileData: string; // base64
  fileSize: number;
}
```

**Logica**:
1. Decode base64 → Uint8Array
2. Upload to storage bucket `pipeline-c-uploads`
3. Insert into `pipeline_c_documents` con `status='ingested'`
4. Return document ID

**Timeout**: 60 secondi
**JWT**: false (public)

### 2. pipeline-c-process-chunks
**Path**: `supabase/functions/pipeline-c-process-chunks/index.ts`

**Trigger**: Cron ogni 10 minuti

**Logica**:
1. Query documenti con `status='ingested'` (batch 10)
2. Per ogni documento:
   - Download PDF da storage
   - Extract text con `pdfTextExtractor`
   - Chunking con `contentAwareChunker`
   - Enrich metadata con `metadataEnricher`
   - Classify con `chunkClassifier`
   - Insert chunks in `pipeline_c_chunks_raw`
3. Update documento → `status='chunked'`

**Timeout**: 600 secondi
**JWT**: false (cron)

### 3. pipeline-c-generate-embeddings
**Path**: `supabase/functions/pipeline-c-generate-embeddings/index.ts`

**Trigger**: Cron ogni 5 minuti

**Logica**:
1. Status reconciliation (documenti stuck)
2. Query chunks con `embedding_status='pending'` (batch 50)
3. Per ogni chunk:
   - Generate embedding (OpenAI text-embedding-3-small)
   - Validate embedding
   - Update chunk con embedding + `embedding_status='ready'`
4. Update documenti → `status='ready'` se tutti chunk ready

**Timeout**: 600 secondi
**JWT**: false (cron)

### 4. pipeline-c-sync-agent
**Path**: `supabase/functions/pipeline-c-sync-agent/index.ts`

**Input**:
```typescript
{
  agent_id: string;
  document_id: string;
}
```

**Logica**:
1. Query chunks ready del documento
2. Insert links in `pipeline_c_agent_knowledge`
3. Return sync status

**Timeout**: 60 secondi
**JWT**: true (authenticated)

---

## Content-Aware Chunking: Dettagli Implementazione

### Semantic Boundary Detection

**Algoritmo**:
1. Analisi struttura documento (regex patterns per headings, liste, code blocks)
2. Identificazione boundaries naturali (fine paragrafo, doppio newline, etc.)
3. Scoring boundaries (weight basato su context)
4. Preservazione coerenza semantica

**Patterns rilevati**:
- Headings: `# Titolo`, `## Sottotitolo`
- Liste: `- Item`, `1. Item`
- Code blocks: ` ```code``` `
- Paragrafi: Doppio newline
- Tabelle: Pattern `|---|---|`

### Adaptive Sizing

**Strategia**:
- **Contenuto tecnico** (code, formule): 500-800 caratteri
- **Contenuto narrativo** (prose): 1200-1500 caratteri
- **Contenuto reference** (liste, tabelle): 200-300 caratteri

**Detection**:
```typescript
function detectContentType(text: string): 'technical' | 'narrative' | 'reference' {
  const codeBlockRatio = (text.match(/```/g) || []).length / text.length;
  const listItemRatio = (text.match(/^[-*]\s/gm) || []).length / text.split('\n').length;
  
  if (codeBlockRatio > 0.1) return 'technical';
  if (listItemRatio > 0.3) return 'reference';
  return 'narrative';
}
```

### Metadata Enrichment

**Semantic Weight Calculation**:
```typescript
function calculateSemanticWeight(chunk: string): number {
  const technicalTerms = detectTechnicalTerms(chunk);
  const conceptDensity = analyzeConceptDensity(chunk);
  const informationDensity = chunk.split(/\s+/).length / chunk.length;
  
  return (technicalTerms * 0.4) + (conceptDensity * 0.4) + (informationDensity * 0.2);
}
```

**Position Tracking**:
- `intro`: Primi 20% del documento
- `body`: 20-80% del documento
- `conclusion`: Ultimi 20% del documento

**Heading Hierarchy**:
```typescript
interface HeadingHierarchy {
  h1?: string;
  h2?: string;
  h3?: string;
  path: string; // "Capitolo 1 > Sezione 1.2 > Sottosezione 1.2.3"
}
```

---

## Quality Metrics & Testing

### Unit Tests

**Boundary Respect Test**:
```typescript
test('chunks should respect semantic boundaries', () => {
  const doc = "Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.";
  const chunks = chunker.chunk(doc);
  
  expect(chunks.every(c => !c.content.includes('\n\n'))).toBe(true);
});
```

**Adaptive Sizing Test**:
```typescript
test('technical content should produce smaller chunks', () => {
  const technicalDoc = "```python\ncode\n```";
  const narrativeDoc = "This is a long narrative paragraph...";
  
  const techChunks = chunker.chunk(technicalDoc);
  const narChunks = chunker.chunk(narrativeDoc);
  
  expect(avgLength(techChunks)).toBeLessThan(avgLength(narChunks));
});
```

### Integration Tests

**End-to-End Processing**:
1. Upload PDF via `pipeline-c-ingest-pdf`
2. Wait for cron processing (10 min)
3. Verify chunks created with correct metadata
4. Wait for embedding generation (5 min)
5. Verify document status = 'ready'
6. Sync to agent
7. Verify semantic search retrieval

### Quality Metrics (Target)

| Metrica | Target | Misurazione |
|---------|--------|-------------|
| Boundary Respect Rate | > 95% | % chunk senza split forzati |
| Semantic Coherence Avg | > 0.8 | Cosine similarity intra-chunk |
| Size Optimization Score | > 0.85 | Distribuzione size vs content type |
| Retrieval Precision | > 75% | Precision@5 su query test |
| Hallucination Rate | < 15% | % risposte senza grounding |

---

## Deployment Checklist

### Pre-Deploy
- [ ] Database migrations executed
- [ ] Storage bucket `pipeline-c-uploads` created
- [ ] Shared libraries tested in isolation
- [ ] Edge functions local testing passed
- [ ] Environment variables configured

### Deploy
- [ ] Deploy edge functions to Supabase
- [ ] Activate cron jobs in config.toml
- [ ] Verify cron execution via logs
- [ ] Test manual document upload
- [ ] Monitor first document processing cycle

### Post-Deploy
- [ ] Monitor error rates (target < 1%)
- [ ] Track processing times (target < 10 min per doc)
- [ ] Validate chunk quality metrics
- [ ] A/B test vs Pipeline B
- [ ] Collect user feedback

---

## Comparison: Pipeline B vs Pipeline C

| Aspetto | Pipeline B (Landing AI) | Pipeline C (Custom) |
|---------|-------------------------|---------------------|
| **Chunking** | Black-box semantico | Content-aware trasparente |
| **Metadata** | Limitati (type, grounding, page) | Arricchiti (10+ campi custom) |
| **Adattabilità** | Fixed strategy | Adaptive sizing per content type |
| **Costo** | API calls Landing AI | Zero costi esterni |
| **Controllo** | Limitato | Totale su ogni fase |
| **Monitoraggio** | Opaco | Metriche dettagliate esposte |
| **Performance** | Dipende da Landing AI uptime | Controllata internamente |
| **Customization** | Impossibile | Totale libertà di modifica |

---

## Note Tecniche

### Perché Content-Aware Chunking?

**Problemi del chunking meccanico**:
- Split arbitrari che spezzano concetti
- Dimensioni fisse inadatte a content type variabile
- Perdita di contesto ai boundaries
- Metadata limitati o assenti

**Vantaggi content-aware**:
- Rispetta semantic boundaries (paragrafi, sezioni)
- Adaptive sizing (tech vs narrative vs reference)
- Metadata arricchiti per retrieval preciso
- Preservazione heading hierarchy
- Migliore coerenza semantica intra-chunk

### Ottimizzazioni Previste

**Stage 2 Processing**:
- Parallel processing di documenti (max 10 concurrent)
- Caching di patterns regex compilati
- Batch insert di chunks (50 per volta)

**Stage 3 Embedding**:
- Batch embedding generation (50 chunks)
- Rate limiting OpenAI (delay 100ms)
- Retry logic con exponential backoff

**Storage**:
- Index su `pipeline_c_chunks_raw(document_id, embedding_status)`
- Index su `pipeline_c_documents(status)`
- GIN index su `pipeline_c_chunks_raw(keywords)`

---

## Roadmap Estesa

### Q1 2025
- ✅ Implementazione Pipeline C core
- ⏳ A/B testing vs Pipeline B
- ⏳ Production deployment

### Q2 2025
- Ottimizzazione performance chunking
- Advanced query expansion nel retrieval
- Metriche di quality monitoring in real-time

### Q3 2025
- Multi-modal support (immagini + testo)
- Hybrid search (keyword + semantic)
- Chunk re-ranking basato su user feedback

### Q4 2025
- Auto-tuning di chunking parameters
- Predictive chunk pre-loading
- Cross-document concept linking

---

## Riferimenti

- **Paper**: "Improving RAG System Evaluation" (PDF allegato)
- **Chunking Config**: maxChunkSize=1500, minChunkSize=200, overlap=100
- **Embedding Model**: OpenAI text-embedding-3-small (1536 dimensions)
- **Database**: PostgreSQL con pgvector extension

---

**Ultimo Aggiornamento**: 2025-01-28
**Versione Roadmap**: 1.0
**Status**: Fase 1 in corso
