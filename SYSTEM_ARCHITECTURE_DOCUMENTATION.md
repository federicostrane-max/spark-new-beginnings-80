# Documentazione Architetturale del Sistema RAG Multi-Agente

## Indice
1. [Panoramica del Sistema](#panoramica-del-sistema)
2. [Gestione Agenti Custom](#gestione-agenti-custom)
3. [Pipeline RAG - Architettura](#pipeline-rag---architettura)
4. [Pipeline A-Hybrid (Gold Standard)](#pipeline-a-hybrid-gold-standard)
5. [Pipeline B (Landing AI)](#pipeline-b-landing-ai)
6. [Sistema di Semantic Search](#sistema-di-semantic-search)
7. [Visual Enrichment](#visual-enrichment)
8. [Agent Chat System](#agent-chat-system)
9. [Database Schema](#database-schema)
10. [Edge Functions Reference](#edge-functions-reference)

---

## Panoramica del Sistema

Il sistema è una piattaforma RAG (Retrieval-Augmented Generation) multi-agente che permette di:
- Creare agenti AI custom con knowledge base personalizzate
- Processare documenti PDF, Markdown e immagini con estrazione avanzata
- Eseguire semantic search ibrida (embedding + keyword)
- Supportare visual enrichment context-aware per grafici/tabelle

### Stack Tecnologico
- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **Backend**: Supabase Edge Functions (Deno)
- **Database**: PostgreSQL con pgvector
- **LLM Providers**: Anthropic Claude, Google Gemini, OpenAI, DeepSeek, OpenRouter
- **Document Processing**: LlamaParse, Claude Vision
- **Embeddings**: OpenAI text-embedding-3-small (1536 dimensioni)

---

## Gestione Agenti Custom

### Tabella `agents`
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  llm_provider TEXT DEFAULT 'anthropic',  -- anthropic, google, openai, deepseek, openrouter
  ai_model TEXT,                           -- es: claude-sonnet-4-5, google/gemini-3-pro-preview
  avatar TEXT,
  active BOOLEAN DEFAULT true,
  user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Funzionalità Agenti
1. **System Prompt Personalizzato**: Ogni agente ha un prompt di sistema che definisce comportamento e competenze
2. **Selezione LLM Provider**: Supporto per multipli provider (Anthropic, Google, OpenAI, etc.)
3. **Knowledge Base Dedicata**: Documenti assegnati specificamente all'agente
4. **Conversation History**: Chat persistenti con memoria contestuale

### Assegnazione Documenti agli Agenti
I documenti vengono collegati agli agenti tramite le tabelle `*_agent_knowledge`:
```sql
-- Per Pipeline A-Hybrid
INSERT INTO pipeline_a_hybrid_agent_knowledge (agent_id, chunk_id, is_active)
SELECT 'agent-uuid', id, true FROM pipeline_a_hybrid_chunks_raw WHERE document_id = 'doc-uuid';
```

---

## Pipeline RAG - Architettura

Il sistema supporta **3 pipeline indipendenti** per il processing dei documenti:

| Pipeline | Parser | Visual Support | Status |
|----------|--------|----------------|--------|
| **A-Hybrid** | LlamaParse JSON + Reconstruction | Claude Vision Context-Aware | ✅ Gold Standard |
| **B** | Landing AI | No | ⚠️ Mantenuto |
| **C** | pdfjs-dist + Custom Chunking | No | ⚠️ Legacy |

### Principio Architetturale: Small-to-Big Retrieval
L'innovazione chiave è la separazione tra:
- **`content`**: Testo per l'embedding (sommari per tabelle)
- **`original_content`**: Markdown originale completo (restituito all'LLM)

```
Query → Embedding Match su content → Return original_content → LLM genera risposta
```

---

## Pipeline A-Hybrid (Gold Standard)

### Flusso di Processing

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PIPELINE A-HYBRID                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. INGEST (pipeline-a-hybrid-ingest-pdf)                               │
│     - Upload file a Supabase Storage                                    │
│     - Crea record in pipeline_a_hybrid_documents                        │
│     - Routing: PDF → split-pdf-into-batches                             │
│              : MD/IMG → pipeline-a-hybrid-process-chunks                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. SPLIT BATCHES (split-pdf-into-batches)                              │
│     - Divide PDF in batch da N pagine (usando pdf-lib)                  │
│     - Crea record processing_jobs per ogni batch                        │
│     - Trigger → process-pdf-batch per primo batch                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. PROCESS BATCH (process-pdf-batch) - Per ogni batch                  │
│     ┌────────────────────────────────────────────────────────────────┐  │
│     │ 3a. LlamaParse JSON Extraction                                 │  │
│     │     - Invia batch PDF a LlamaParse API                         │  │
│     │     - Riceve JSON con elementi strutturati (text, table, img)  │  │
│     └────────────────────────────────────────────────────────────────┘  │
│     ┌────────────────────────────────────────────────────────────────┐  │
│     │ 3b. Document Reconstruction (documentReconstructor.ts)         │  │
│     │     - Ordina elementi per pagina → Y-zone → X-position         │  │
│     │     - Ricostruisce "Super-Document" lineare                    │  │
│     └────────────────────────────────────────────────────────────────┘  │
│     ┌────────────────────────────────────────────────────────────────┐  │
│     │ 3c. Visual Enrichment Queue                                    │  │
│     │     - Identifica immagini (layout_picture, layout_table)       │  │
│     │     - Scarica da LlamaParse, salva base64                      │  │
│     │     - Inserisce in visual_enrichment_queue                     │  │
│     │     - Crea chunk dedicati (embedding_status='waiting_enrich')  │  │
│     └────────────────────────────────────────────────────────────────┘  │
│     ┌────────────────────────────────────────────────────────────────┐  │
│     │ 3d. Markdown Parsing (markdownElementParser.ts)                │  │
│     │     - Identifica atomic elements (tabelle, code blocks)        │  │
│     │     - Semantic Chunk Type Detection (cover_page, balance_...)  │  │
│     │     - Genera summary LLM per tabelle grandi                    │  │
│     │     - Crea chunks con content + original_content               │  │
│     └────────────────────────────────────────────────────────────────┘  │
│     - Event-driven: Trigger → next batch OPPURE aggregate-document     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. VISUAL ENRICHMENT (process-vision-queue / process-vision-job)       │
│     - Processa immagini dalla queue in parallelo                        │
│     - Context Analyzer: determina dominio (finance, trading, medical)   │
│     - Claude Vision con prompt domain-specific                          │
│     - Aggiorna chunk con descrizione + genera embedding                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. AGGREGATE (aggregate-document-batches)                              │
│     - Verifica completamento tutti i batch                              │
│     - Page-Chunk Ratio Check (self-healing se estrazione insufficiente) │
│     - Aggiorna document status → 'chunked'                              │
│     - Trigger → pipeline-a-hybrid-generate-embeddings                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  6. EMBEDDINGS (pipeline-a-hybrid-generate-embeddings)                  │
│     - Processa chunks con embedding_status='pending'                    │
│     - Genera embedding OpenAI text-embedding-3-small                    │
│     - Self-continuation: ri-invoca se stesso se ci sono altri chunks    │
│     - Quando tutti i chunks sono 'ready' → document status = 'ready'    │
│     - Trigger → assign-benchmark-chunks (se benchmark document)         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  7. AGENT SYNC (pipeline-a-hybrid-sync-agent)                           │
│     - Collega chunks a specifici agenti                                 │
│     - Crea record in pipeline_a_hybrid_agent_knowledge                  │
│     - Documenti ora ricercabili dall'agente                             │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tabelle Database Pipeline A-Hybrid

```sql
-- Documenti
CREATE TABLE pipeline_a_hybrid_documents (
  id UUID PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_bucket TEXT DEFAULT 'pipeline-a-uploads',
  status TEXT DEFAULT 'ingested',  -- ingested, processing, chunked, ready, failed
  extraction_mode TEXT DEFAULT 'auto',  -- auto, premium
  extraction_attempts INTEGER DEFAULT 0,
  llamaparse_job_id TEXT,
  folder TEXT,
  source_type TEXT,  -- pdf, markdown, image
  processing_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Chunks
CREATE TABLE pipeline_a_hybrid_chunks_raw (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES pipeline_a_hybrid_documents(id),
  chunk_index INTEGER NOT NULL,
  batch_index INTEGER,
  content TEXT NOT NULL,           -- Per embedding (summary per tabelle)
  original_content TEXT,           -- Markdown originale (per LLM)
  chunk_type TEXT,                 -- text, table, visual, cover_page, balance_sheet, etc.
  is_atomic BOOLEAN DEFAULT false,
  embedding_status TEXT DEFAULT 'pending',  -- pending, processing, ready, waiting_enrichment, failed
  embedding vector(1536),
  page_number INTEGER,
  heading_hierarchy JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent Knowledge Links
CREATE TABLE pipeline_a_hybrid_agent_knowledge (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  chunk_id UUID REFERENCES pipeline_a_hybrid_chunks_raw(id),
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ DEFAULT now()
);
```

### Semantic Chunk Types
Il parser identifica automaticamente tipi semantici per documenti finanziari/SEC:

| Tipo | Pattern di Riconoscimento |
|------|---------------------------|
| `cover_page` | "securities registered pursuant to", "Form 10-K", SEC header |
| `balance_sheet` | "total assets", "total liabilities", "financial position" |
| `income_statement` | "net revenues", "operating income", "statement of operations" |
| `cash_flow_statement` | "cash flows from operating activities" |
| `exhibit` | "exhibit index", "exhibit number" |
| `notes_disclosure` | "notes to financial statements" |

---

## Pipeline B (Landing AI)

Pipeline alternativa che usa Landing AI per il parsing. **NON estesa** con Small-to-Big perché i chunks sono troppo frammentati.

### Flusso
```
1. pipeline-b-ingest-pdf → Upload e crea record
2. pipeline-b-process-chunks → Landing AI parsing (CRON every 10 min)
3. pipeline-b-generate-embeddings → OpenAI embeddings (CRON every 5 min)
4. pipeline-b-sync-agent → Collega a agenti
```

---

## Sistema di Semantic Search

### Edge Function: `semantic-search`

Implementa **True Hybrid Search**: semantic + keyword FTS in parallelo.

```typescript
// Esecuzione parallela
const [semanticResponse, keywordResponse] = await Promise.all([
  supabase.rpc('match_documents', { query_embedding, p_agent_id, match_threshold: 0.10 }),
  supabase.rpc('keyword_search_documents', { search_query, p_agent_id })
]);

// Merge e deduplica
// search_type: 'semantic' | 'keyword' | 'hybrid' (trovato da entrambi)
```

### Query-Aware Chunk Boosting
Post-retrieval re-ranking basato su intent detection:

```typescript
// Intent Types
type QueryIntent = 
  | 'balance_sheet_metric'      // ROA, debt ratios, assets
  | 'income_statement_metric'   // margins, revenue, EPS
  | 'cash_flow_metric'          // capex, FCF
  | 'filing_metadata'           // securities registered, auditor
  | 'segment_analysis'          // segment revenue
  | 'general';

// Boost multipliers per chunk_type
const BOOST_MAPS = {
  'filing_metadata': { cover_page: 3.0, header: 2.5, exhibit: 2.0 },
  'balance_sheet_metric': { balance_sheet: 2.5, table: 1.8 },
  // ...
};
```

### Hybrid Query Expansion
Espansione query con LLM + cache persistente:

```typescript
// expand-query-llm edge function
1. Normalizza query
2. Check cache (query_expansion_cache table, SHA-256 hash)
3. Cache miss → LLM (Gemini Flash Lite) genera espansione con termini GAAP/IFRS
4. Salva in cache (no TTL - termini finanziari stabili)
5. Return expanded query
```

### RPC Functions

```sql
-- Semantic search con pre-filtering opzionale per documento
CREATE FUNCTION match_documents(
  query_embedding vector,
  p_agent_id UUID,
  match_threshold DOUBLE DEFAULT 0.5,
  match_count INTEGER DEFAULT 10,
  p_document_name TEXT DEFAULT NULL  -- PRE-FILTER
) RETURNS TABLE (id, content, similarity, document_name, chunk_type, pipeline_source)

-- Keyword search (Full-Text Search PostgreSQL)
CREATE FUNCTION keyword_search_documents(
  search_query TEXT,
  p_agent_id UUID,
  match_count INTEGER DEFAULT 10,
  p_document_name TEXT DEFAULT NULL  -- PRE-FILTER
) RETURNS TABLE (...)
```

---

## Visual Enrichment

### Architettura Context-Aware

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      VISUAL ENRICHMENT PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────┘

1. CONTEXT ANALYZER (contextAnalyzer.ts)
   - Input: Campione testo documento
   - Output: { domain, focusElements, terminology, verbosity }
   - Model: Claude 3.5 Haiku
   - Domains: trading, trading_view_pro, finance, architecture, medical, legal, science

2. DYNAMIC PROMPT GENERATOR (visionEnhancer.ts → buildContextAwareVisualPrompt)
   - Genera prompt specifico per dominio
   - Trading: focus su candlestick, SMA/EMA, support/resistance
   - Finance: focus su financial statements, percentages, YoY changes
   - Architecture: focus su dimensioni, room areas, orientations

3. CLAUDE VISION CALL
   - Model: Claude Haiku 4.5
   - Input: Image base64 + domain-specific prompt
   - Output: Descrizione strutturata (max 800 chars)
   - Format: [TYPE], [TITLE], [PAGE], [CONTEXT], [DATA] in Markdown

4. CHUNK UPDATE
   - Aggiorna chunk.content con descrizione
   - Genera embedding immediatamente
   - embedding_status: waiting_enrichment → ready
```

### Visual Enrichment Queue Table

```sql
CREATE TABLE visual_enrichment_queue (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES pipeline_a_hybrid_documents(id),
  chunk_id UUID REFERENCES pipeline_a_hybrid_chunks_raw(id),
  image_base64 TEXT NOT NULL,
  image_metadata JSONB,  -- { image_name, type, page, batch_index }
  status TEXT DEFAULT 'pending',  -- pending, processing, completed, failed
  enrichment_text TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);
```

---

## Agent Chat System

### Edge Function: `agent-chat`

Gestisce conversazioni con agenti, con supporto per multipli LLM providers.

```typescript
// Flusso principale
1. Ricevi messaggio utente
2. Query Decomposition (LLM split query complesse in sub-queries)
3. Parallel Semantic Search per ogni sub-query
4. Document Pre-Filtering (se query specifica documento)
5. Merge e deduplica chunks
6. Build context con chunks retrieved
7. Call LLM (Anthropic/Google/OpenAI/DeepSeek) con streaming
8. Return SSE response
```

### Providers Supportati

| Provider | Models | Notes |
|----------|--------|-------|
| Anthropic | claude-sonnet-4-5, claude-haiku-4-5 | Default, streaming SSE |
| Google | gemini-3-pro-preview, gemini-2.5-flash | Richiede `&alt=sse` |
| OpenAI | gpt-4o, gpt-4o-mini | Standard |
| DeepSeek | deepseek-chat | Economico |
| OpenRouter | Various | Gateway per multipli modelli |

### Conversation Persistence

```sql
CREATE TABLE agent_conversations (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  user_id UUID NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID REFERENCES agent_conversations(id),
  role TEXT NOT NULL,  -- 'user' | 'assistant'
  content TEXT NOT NULL,
  llm_provider TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Database Schema

### Tabelle Principali

| Tabella | Scopo |
|---------|-------|
| `agents` | Definizione agenti custom |
| `agent_conversations` | Sessioni chat |
| `agent_messages` | Messaggi nelle conversazioni |
| `pipeline_a_hybrid_documents` | Documenti Pipeline A |
| `pipeline_a_hybrid_chunks_raw` | Chunks con embedding |
| `pipeline_a_hybrid_agent_knowledge` | Link agent-chunks |
| `visual_enrichment_queue` | Queue visual processing |
| `processing_jobs` | Jobs per batch PDF processing |
| `query_expansion_cache` | Cache espansioni query |
| `benchmark_datasets` | Dataset per benchmark testing |
| `benchmark_results` | Risultati benchmark |

### Indici Critici

```sql
-- Vector similarity search
CREATE INDEX idx_chunks_embedding ON pipeline_a_hybrid_chunks_raw 
  USING ivfflat (embedding vector_cosine_ops);

-- Agent knowledge lookup
CREATE INDEX idx_agent_knowledge_agent_chunk 
  ON pipeline_a_hybrid_agent_knowledge(agent_id, chunk_id);

-- Document status filtering
CREATE INDEX idx_documents_status 
  ON pipeline_a_hybrid_documents(status);
```

---

## Edge Functions Reference

### Document Processing

| Function | Trigger | Descrizione |
|----------|---------|-------------|
| `pipeline-a-hybrid-ingest-pdf` | HTTP POST | Entry point upload documenti |
| `split-pdf-into-batches` | Event-driven | Divide PDF in batch |
| `process-pdf-batch` | Event-driven + CRON | Processa singolo batch |
| `aggregate-document-batches` | Event-driven | Aggrega risultati batch |
| `pipeline-a-hybrid-process-chunks` | Event-driven + CRON | Processa MD/IMG direttamente |
| `pipeline-a-hybrid-generate-embeddings` | Event-driven + CRON | Genera embeddings |
| `pipeline-a-hybrid-sync-agent` | HTTP POST | Assegna documenti ad agente |

### Visual Enrichment

| Function | Trigger | Descrizione |
|----------|---------|-------------|
| `process-vision-queue` | CRON (1 min) | Processa batch immagini dalla queue |
| `process-vision-job` | Event-driven | Processa singola immagine |

### Search & Chat

| Function | Trigger | Descrizione |
|----------|---------|-------------|
| `semantic-search` | HTTP POST | True Hybrid Search |
| `expand-query-llm` | HTTP POST | Query expansion con cache |
| `agent-chat` | HTTP POST | Chat streaming con agente |

### Benchmark

| Function | Trigger | Descrizione |
|----------|---------|-------------|
| `provision-benchmark-datasets` | HTTP POST | Scarica e processa dataset benchmark |
| `assign-benchmark-chunks` | Event-driven + CRON | Assegna chunks a agente benchmark |
| `run-benchmark` | HTTP POST | Esegue benchmark suite |
| `evaluate-answer` | HTTP POST | LLM Judge per valutazione risposte |

---

## Configurazione CRON Jobs

```toml
# supabase/config.toml

[functions.pipeline-a-hybrid-process-chunks]
schedule = "*/5 * * * *"  # Every 5 minutes

[functions.pipeline-a-hybrid-generate-embeddings]
schedule = "*/5 * * * *"  # Every 5 minutes

[functions.process-vision-queue]
schedule = "* * * * *"    # Every minute

[functions.process-batch-jobs-queue]
schedule = "* * * * *"    # Every minute

[functions.assign-benchmark-chunks]
schedule = "*/5 * * * *"  # Every 5 minutes
```

---

## Secrets Richiesti

| Secret | Utilizzo |
|--------|----------|
| `OPENAI_API_KEY` | Embeddings (text-embedding-3-small) |
| `ANTHROPIC_API_KEY` | Claude Vision, Agent Chat |
| `LLAMA_CLOUD_API_KEY` | LlamaParse PDF processing |
| `LOVABLE_API_KEY` | Gateway AI (Gemini, etc.) |
| `GOOGLE_AI_STUDIO_API_KEY` | Google Gemini direct |

---

## Metriche di Performance

### Benchmark FinanceBench
- **Accuracy**: 90% (9/10 valid questions)
- **Semantic Threshold**: 0.10 (ottimale)
- **Query Expansion**: Gemini Flash Lite + Cache

### Processing Times
- **PDF Ingest**: ~30 secondi (senza attendere processing)
- **Batch Processing**: ~2-5 minuti per batch (dipende da pagine e immagini)
- **Visual Enrichment**: ~3-5 secondi per immagine
- **Embedding Generation**: ~50 chunks/batch

---

## Note Architetturali Critiche

1. **Event-Driven over CRON**: Preferire `EdgeRuntime.waitUntil()` per catena veloce, CRON come fallback
2. **Pre-Filter vs Post-Filter**: SEMPRE pre-filter a livello RPC per query document-specific
3. **Parallel Invocations Anti-Pattern**: Mai invocare multipli batch in parallelo (race conditions)
4. **Visual Chunks Separati**: Ogni immagine ha chunk dedicato per embedding focalizzato
5. **Self-Continuation**: Funzioni che si ri-invocano per completare lavoro senza attendere CRON
