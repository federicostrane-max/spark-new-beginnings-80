# Pipeline B Implementation Blueprint
**Landing AI + Nexla Agentic Chunking**

---

## 📊 Status Dashboard

**Current Phase**: 🚧 Milestone 1 - Infrastructure Setup
**Progress**: 1/38 tasks completed (2.6%)
**Estimated Total**: ~32-40 hours
**Started**: 2025-01-18
**Expected Completion**: 2025-01-30
⚠️ **Critical requirement added**: Validated dataset integration for ML-driven pipeline selection

**Active Milestone**: Milestone 1: Database + Nexla
**Last Updated**: 2025-01-18 19:45:00
**Last Context**: Completed Task 1.1 - Database Migration with auto-save system

---

## 🎯 Quick Resume Context

**What I was doing**:
- ✅ Completed Task 1.1: Database Migration (added chunking_strategy to knowledge_documents, chunking_metadata to agent_knowledge)
- ✅ Implemented auto-save system in src/lib/pipelineBLogger.ts
- Migration deployed successfully with new columns and index

**Next Steps**:
- [ ] Task 1.2: Nexla Microservice - Code Setup (FastAPI app with ai-chunking library)
- [ ] Task 1.3: Deploy microservice to Railway
- [ ] Task 1.4: Integrate Nexla endpoint into Supabase edge functions

**Blockers**:
- None currently

**Recent Decisions**:
- [2025-01-18 19:45] **CRITICAL**: Sistema di testing automatizzato con dataset validato richiesto per decision-making data-driven Pipeline A vs B
- [2025-01-18 19:30] Using localStorage for Pipeline B state persistence (frontend)
- [2025-01-18 19:30] Auto-save functions: pausePipelineB(), resumePipelineB(), completeTask()
- Using dual-pipeline approach (A: existing, B: Landing AI + Nexla)
- Implementing in feature branch `feature/pipeline-b`
- Shadow mode testing before production rollout

---

## ⚠️ REQUISITO CRITICO: Sistema di Testing Automatizzato

### Obiettivo
Creare un sistema di testing automatizzato basato su un **dataset già validato e accessibile via API**, progettato per:
1. **Valutare oggettivamente** le prestazioni di parsing e chunking delle Pipeline A e B
2. **Addestrare automaticamente** il sistema a riconoscere i tipi di documenti in ingresso
3. **Decidere automaticamente** quando usare Pipeline A (economica) vs Pipeline B (sofisticata)

### Dataset di Test
Il dataset deve essere:
- **Accessibile via API** (endpoint dedicato per il testing)
- **Validato da esperti** (ground truth verificata)
- **Strutturato per categoria**:
  - 📜 Documenti storici (testo denso, riferimenti bibliografici)
  - 🔧 Documenti tecnici (procedure, istruzioni operative)
  - 📊 Documenti con tabelle complesse
  - 📈 Documenti con grafici e immagini
- **Completo di**:
  - Domande di verifica (Q&A pairs)
  - Risposte corrette attese
  - Metadata di classificazione (complessità, tipo layout, presenza tabelle)
  - Output ideali (chunk boundaries, extracted entities)

### Metriche di Valutazione
Per ogni documento testato:
- **Qualità del chunking**: Boundaries semantici preservati? Score 0-100
- **Preservazione semantica**: Le risposte alle domande sono corrette? Accuracy %
- **Precisione estrazione**: Tabelle, citazioni, entità estratte correttamente? Precision/Recall
- **Performance**: Tempo di processing, costo per documento

### Sistema di Addestramento
Il sistema deve apprendere a classificare i documenti in ingresso per scegliere la pipeline ottimale:

**Input Features** (caratteristiche del documento):
- Presenza di tabelle (booleano + count)
- Complessità layout (simple/complex, score 0-100)
- Lunghezza documento (page count, text length)
- Presenza di immagini/grafici
- Densità di riferimenti bibliografici

**Output** (raccomandazione):
- `use_pipeline_a`: Documento semplice, priorità costo/velocità
- `use_pipeline_b`: Documento complesso, priorità accuratezza
- Confidence score della raccomandazione

**Decision Factors**:
```
IF has_tables > 3 OR layout_complexity > 70:
  → Raccomanda Pipeline B
ELSE IF page_count < 10 AND layout_complexity < 40:
  → Raccomanda Pipeline A
ELSE:
  → Valuta cost/benefit based on historical accuracy data
```

### Fasi di Implementazione

#### Fase 1: Dataset Integration + Automated Testing (Milestone 4)
- [ ] Integrare API endpoint del dataset di test
- [ ] Implementare framework di valutazione Q&A
- [ ] Creare test suites per categoria (storico, tecnico, tabelle, grafici)
- [ ] Generare report di performance per tipo documento
- [ ] Baseline metrics per Pipeline A
- [ ] Comparative metrics Pipeline A vs B

#### Fase 2: Classification Model Training (Milestone 5)
- [ ] Raccogliere features da documenti processati
- [ ] Etichettare documenti con pipeline ottimale (based on test results)
- [ ] Addestrare modello di classificazione (decision tree o logistic regression)
- [ ] Validare accuratezza predizioni su test set
- [ ] Deploy modello come edge function `classify-document`

#### Fase 3: Auto-Routing (Post-MVP)
- [ ] Integrare `classify-document` in upload flow
- [ ] Override manuale disponibile in UI
- [ ] Monitoring delle scelte automatiche vs manuali
- [ ] Retraining periodico basato su feedback

### Benefici Attesi
- ✅ **Decision-making oggettivo**: Non più "gut feeling", ma dati verificati
- ✅ **Ottimizzazione costi**: Pipeline A per documenti semplici (90% dei casi?)
- ✅ **Massima accuratezza**: Pipeline B solo dove serve davvero
- ✅ **Continuous improvement**: Il sistema impara dai documenti processati

---

## 📋 Implementation Roadmap

### Milestone 1: Infrastructure Setup (Database + Nexla)
**Goal**: Deploy database changes and Nexla microservice
**Estimated Time**: 6-8 hours
**Dependencies**: None
**Deployable**: ✅ Yes (independent of Pipeline A)

#### Task 1.1: Database Migration
**Time**: 1.5 hours | **Status**: ✅ Completed | **Depends on**: None | **Completed**: 2025-01-18 19:30

- [x] Create migration file `20250118000000_add_pipeline_b_support.sql`
- [x] Add `chunking_strategy` column to `knowledge_documents`
  ```sql
  ALTER TABLE knowledge_documents 
  ADD COLUMN chunking_strategy TEXT DEFAULT 'sliding_window' 
  CHECK (chunking_strategy IN ('sliding_window', 'landing_ai_nexla'));
  ```
- [x] Add `chunking_metadata` JSONB column to `agent_knowledge`
  ```sql
  ALTER TABLE agent_knowledge
  ADD COLUMN chunking_metadata JSONB DEFAULT '{}'::jsonb;
  ```
- [x] Create index `idx_knowledge_documents_chunking_strategy`
- [x] Test migration on staging (verify no breaking changes)
- [x] Deploy migration to production

**Implementation Notes**:
- Migration deployed successfully via supabase--migration tool
- Added documentation comments to both columns
- Index created for efficient filtering by chunking_strategy
- Default value '{}' set for chunking_metadata JSONB column
- Created auto-save system in `src/lib/pipelineBLogger.ts` with functions:
  - `pausePipelineB()` - Save state when interrupting
  - `resumePipelineB()` - Load state when continuing
  - `completeTask()` - Mark tasks as done
  - `addBlocker()`, `logDecision()` - Track issues and decisions

**Verification**:
```sql
-- Verify columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('knowledge_documents', 'agent_knowledge') 
AND column_name IN ('chunking_strategy', 'chunking_metadata');
```

---

#### Task 1.2: Nexla Microservice - Code Setup
**Time**: 2 hours | **Status**: ⬜ Not Started | **Depends on**: None

- [ ] Create new directory `microservice/nexla-chunker/`
- [ ] Create `main.py` with FastAPI app
  ```python
  from fastapi import FastAPI, HTTPException
  from pydantic import BaseModel
  from ai_chunking import AutoAIChunker
  
  app = FastAPI()
  chunker = AutoAIChunker(
      llm_provider="openai",
      chunk_size=800,
      overlap=150
  )
  ```
- [ ] Create `requirements.txt` (fastapi, uvicorn, ai-chunking, pydantic)
- [ ] Create `Dockerfile`
  ```dockerfile
  FROM python:3.10-slim
  WORKDIR /app
  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt
  COPY . .
  CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
  ```
- [ ] Implement `/chunk` POST endpoint
- [ ] Add error handling and logging
- [ ] Add health check endpoint `/health`

**Test Locally**:
```bash
docker build -t nexla-chunker .
docker run -p 8000:8000 -e OPENAI_API_KEY=xxx nexla-chunker
curl -X POST http://localhost:8000/chunk -H "Content-Type: application/json" -d '{"text":"...", "metadata":{}}'
```

---

#### Task 1.3: Nexla Microservice - Railway Deploy
**Time**: 1.5 hours | **Status**: ⬜ Not Started | **Depends on**: Task 1.2

- [ ] Create Railway account (if not exists)
- [ ] Create new Railway project "nexla-chunker"
- [ ] Connect GitHub repo with microservice code
- [ ] Configure environment variables:
  - [ ] `OPENAI_API_KEY` (from Railway secrets)
  - [ ] `NEXLA_API_KEY` (generate random secret for auth)
- [ ] Deploy to Railway
- [ ] Verify public URL assigned (e.g., `nexla-chunker.railway.app`)
- [ ] Test endpoint from external network
- [ ] Configure health check monitoring
- [ ] Set up auto-deploy on push to `feature/pipeline-b`

**Verification**:
```bash
curl -X POST https://nexla-chunker.railway.app/chunk \
  -H "Authorization: Bearer $NEXLA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Sample text for chunking test", "metadata":{}}'
```

---

#### Task 1.4: Supabase Secrets Configuration
**Time**: 0.5 hours | **Status**: ⬜ Not Started | **Depends on**: Task 1.3

- [ ] Add `LANDING_AI_API_KEY` to Supabase secrets
- [ ] Add `NEXLA_MICROSERVICE_URL` to Supabase secrets (Railway URL)
- [ ] Add `NEXLA_API_KEY` to Supabase secrets (same as Railway)
- [ ] Verify secrets accessible from edge functions:
  ```typescript
  console.log('LANDING_AI_API_KEY exists:', !!Deno.env.get('LANDING_AI_API_KEY'));
  ```

---

#### Task 1.5: Milestone 1 Integration Test
**Time**: 1 hour | **Status**: ⬜ Not Started | **Depends on**: Tasks 1.1, 1.2, 1.3, 1.4

- [ ] Create test edge function `test-pipeline-b-infrastructure/index.ts`
- [ ] Test database schema (insert test document with `chunking_strategy='landing_ai_nexla'`)
- [ ] Test Nexla microservice call from edge function
- [ ] Verify response format matches expectations
- [ ] Clean up test data
- [ ] Document any issues in "Issues Log" section below

**Success Criteria**:
- ✅ Database accepts new columns
- ✅ Nexla microservice responds < 5 seconds
- ✅ Secrets accessible from edge functions

---

### Milestone 2: Pipeline B Edge Function + Landing AI
**Goal**: Implement full Pipeline B document processing
**Estimated Time**: 8-10 hours
**Dependencies**: Milestone 1 completed
**Deployable**: ✅ Yes (new function, doesn't affect Pipeline A)

#### Task 2.1: Create Shared Embedding Service
**Time**: 2 hours | **Status**: ⬜ Not Started | **Depends on**: Milestone 1

- [ ] Create `supabase/functions/_shared/embeddingService.ts`
- [ ] Extract embedding generation logic from existing functions
- [ ] Implement batch embedding generation (10 chunks at a time)
- [ ] Add retry logic for OpenAI API failures
- [ ] Add rate limiting (60 req/min)
- [ ] Export `generateEmbedding(text: string)` and `generateEmbeddings(texts: string[])`

**Code Structure**:
```typescript
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: text,
      model: 'text-embedding-3-small'
    })
  });
  
  const data = await response.json();
  return data.data[0].embedding;
}
```

---

#### Task 2.2: Landing AI Integration Module
**Time**: 2.5 hours | **Status**: ⬜ Not Started | **Depends on**: None

- [ ] Create `supabase/functions/_shared/landingAIService.ts`
- [ ] Implement `parsePDF(pdfBase64: string)` function
- [ ] Handle Landing AI API authentication
- [ ] Parse response (text, tables, structural chunks, metadata)
- [ ] Add error handling for API failures
- [ ] Add logging for debugging
- [ ] Test with sample PDF (multi-column, tables, images)

**Expected Response Format**:
```typescript
interface LandingAIResponse {
  text: string;
  tables: Array<{id: string, content: string}>;
  chunks: Array<{id: string, text: string, layout: string}>;
  metadata: {
    page_count: number;
    has_tables: boolean;
    layout_complexity: 'simple' | 'complex';
  };
}
```

---

#### Task 2.3: Edge Function - upload-pdf-to-pool-landing-ai
**Time**: 3 hours | **Status**: ⬜ Not Started | **Depends on**: Tasks 2.1, 2.2

- [ ] Create `supabase/functions/upload-pdf-to-pool-landing-ai/index.ts`
- [ ] Implement request parsing (pdfBase64, fileName, agentId)
- [ ] Step 1: Call Landing AI parsing
- [ ] Step 2: Call Nexla microservice for agentic chunking
- [ ] Step 3: Create document in `knowledge_documents` with `chunking_strategy='landing_ai_nexla'`
- [ ] Step 4: Generate embeddings using shared service
- [ ] Step 5: Insert chunks into `agent_knowledge` with metadata
- [ ] Step 6: Update document status to 'completed'
- [ ] Add comprehensive error handling
- [ ] Add logging with `[Pipeline B]` prefix

**Error Handling Checklist**:
- [ ] Landing AI API failure → Return 502 with clear message
- [ ] Nexla microservice timeout → Retry once, then fail gracefully
- [ ] Embedding generation failure → Retry 3 times per chunk
- [ ] Database insertion failure → Rollback transaction

---

#### Task 2.4: Update config.toml
**Time**: 0.5 hours | **Status**: ⬜ Not Started | **Depends on**: Task 2.3

- [ ] Add `upload-pdf-to-pool-landing-ai` to `supabase/config.toml`
- [ ] Set `verify_jwt = true` (requires authentication)
- [ ] Verify no breaking changes to existing functions
- [ ] Test deploy configuration

---

#### Task 2.5: Milestone 2 End-to-End Test
**Time**: 2 hours | **Status**: ⬜ Not Started | **Depends on**: Tasks 2.1-2.4

- [ ] Prepare 3 test PDFs:
  - Simple text-only (5 pages)
  - Complex multi-column with tables (15 pages)
  - Image-heavy document (10 pages)
- [ ] Process each PDF through Pipeline B
- [ ] Verify chunks created in database
- [ ] Verify `chunking_metadata` populated correctly
- [ ] Compare chunk count vs Pipeline A (expect 20-40% fewer chunks)
- [ ] Measure processing time (expect 3-5x slower than Pipeline A)
- [ ] Document results in "Test Results" section below

**Success Criteria**:
- ✅ All 3 PDFs processed without errors
- ✅ Chunks have semantic boundaries preserved
- ✅ Tables extracted and included in metadata
- ✅ Processing time < 2 minutes per document

---

### Milestone 3: Frontend Strategy Selector
**Goal**: Allow users to choose Pipeline A or B when uploading
**Estimated Time**: 4-5 hours
**Dependencies**: Milestone 2 completed
**Deployable**: ✅ Yes (UI-only changes)

#### Task 3.1: Update DocumentPoolUpload Component
**Time**: 2 hours | **Status**: ⬜ Not Started | **Depends on**: Milestone 2

- [ ] Open `src/components/DocumentPoolUpload.tsx`
- [ ] Add state: `const [chunkingStrategy, setChunkingStrategy] = useState<'sliding_window' | 'landing_ai_nexla'>('sliding_window')`
- [ ] Add UI selector (RadioGroup or Select) above file input
  ```tsx
  <RadioGroup value={chunkingStrategy} onValueChange={setChunkingStrategy}>
    <RadioGroupItem value="sliding_window">
      Pipeline A - Sliding Window (veloce, economico) ✅
    </RadioGroupItem>
    <RadioGroupItem value="landing_ai_nexla">
      Pipeline B - Landing AI + Nexla (avanzato, lento) 🚀
    </RadioGroupItem>
  </RadioGroup>
  ```
- [ ] Update upload handler to call correct edge function based on strategy
- [ ] Add cost/time estimates in UI ("Est. $0.02, 10 sec" vs "Est. $0.15, 60 sec")
- [ ] Add tooltip explaining differences

---

#### Task 3.2: Auto-Selection Logic (Optional Enhancement)
**Time**: 1.5 hours | **Status**: ⬜ Not Started | **Depends on**: Task 3.1

- [ ] Implement auto-detection of "complex" PDFs:
  ```typescript
  function recommendStrategy(file: File): 'sliding_window' | 'landing_ai_nexla' {
    if (file.size > 5_000_000) return 'landing_ai_nexla'; // > 5MB
    // TODO: Add table detection heuristic
    return 'sliding_window';
  }
  ```
- [ ] Show recommendation badge in UI
- [ ] Allow user to override recommendation
- [ ] Track auto-selection accuracy for future ML model

---

#### Task 3.3: Document Details View Enhancement
**Time**: 1 hour | **Status**: ⬜ Not Started | **Depends on**: Task 3.1

- [ ] Update `DocumentDetailsDialog.tsx`
- [ ] Display `chunking_strategy` badge
- [ ] Show `chunking_metadata` in expandable section
- [ ] For Pipeline B documents, show:
  - Landing AI chunk count
  - Tables extracted count
  - Semantic boundaries preserved count
  - Processing time

---

#### Task 3.4: Milestone 3 User Testing
**Time**: 0.5 hours | **Status**: ⬜ Not Started | **Depends on**: Tasks 3.1-3.3

- [ ] Upload 2 documents using Pipeline A
- [ ] Upload 2 documents using Pipeline B
- [ ] Verify correct edge function called
- [ ] Verify UI displays strategy correctly
- [ ] Test auto-selection recommendation
- [ ] Gather feedback on UX clarity

---

### Milestone 4: A/B Testing Framework
**Goal**: Compare Pipeline A vs B performance on same documents
**Estimated Time**: 6-7 hours
**Dependencies**: Milestone 3 completed
**Deployable**: ✅ Yes (analytics/admin feature)

#### Task 4.1: Comparison Metrics Table
**Time**: 1 hour | **Status**: ⬜ Not Started | **Depends on**: None

- [ ] Create migration for `pipeline_comparison_metrics` table:
  ```sql
  CREATE TABLE pipeline_comparison_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES knowledge_documents(id),
    pipeline_a_chunks INT,
    pipeline_b_chunks INT,
    pipeline_a_time_ms INT,
    pipeline_b_time_ms INT,
    pipeline_a_cost_usd DECIMAL(10,4),
    pipeline_b_cost_usd DECIMAL(10,4),
    alignment_score_diff DECIMAL(5,3),
    winner TEXT CHECK (winner IN ('pipeline_a', 'pipeline_b', 'tie')),
    tested_at TIMESTAMPTZ DEFAULT now()
  );
  ```
- [ ] Deploy migration

---

#### Task 4.2: Edge Function - compare-chunking-strategies
**Time**: 3 hours | **Status**: ⬜ Not Started | **Depends on**: Task 4.1, Milestone 2

- [ ] Create `supabase/functions/compare-chunking-strategies/index.ts`
- [ ] Accept `pdfBase64` and `fileName` in request
- [ ] Process document through Pipeline A (call existing function)
- [ ] Process document through Pipeline B (call new function)
- [ ] Compare metrics:
  - Chunk count
  - Average chunk size
  - Boundary violations (for Pipeline A)
  - Semantic boundaries preserved (for Pipeline B)
  - Tables extracted (Pipeline B only)
  - Processing time
  - Cost estimate
- [ ] Insert results into `pipeline_comparison_metrics`
- [ ] Return comparison report JSON
- [ ] Add logging for debugging

**Comparison Logic**:
```typescript
function determineWinner(metricsA, metricsB): 'pipeline_a' | 'pipeline_b' | 'tie' {
  const scoreA = (metricsA.chunks * 0.3) + (metricsA.time_ms * -0.2) + (metricsA.cost_usd * -0.5);
  const scoreB = (metricsB.chunks * 0.3) + (metricsB.time_ms * -0.2) + (metricsB.cost_usd * -0.5) + (metricsB.tables_extracted * 0.1);
  
  if (Math.abs(scoreA - scoreB) < 0.05) return 'tie';
  return scoreA > scoreB ? 'pipeline_a' : 'pipeline_b';
}
```

---

#### Task 4.3: Admin Dashboard - A/B Testing View
**Time**: 2.5 hours | **Status**: ⬜ Not Started | **Depends on**: Task 4.2

- [ ] Create `src/components/PipelineComparisonDashboard.tsx`
- [ ] Query `pipeline_comparison_metrics` table
- [ ] Display aggregate statistics:
  - Total tests run
  - Pipeline A wins / Pipeline B wins / Ties
  - Average metrics for each pipeline
  - Cost difference ($X saved or $Y extra)
- [ ] Add document-level comparison table
- [ ] Add "Run New Comparison" button (triggers edge function)
- [ ] Add filters (date range, document size, has_tables)
- [ ] Add export to CSV functionality

---

#### Task 4.4: Automated Testing with Validated Dataset
**Time**: 3.5 hours | **Status**: ⬜ Not Started | **Depends on**: Task 4.2

**Subtask 4.4.1: Dataset API Integration**
- [ ] Create edge function `get-test-dataset` to fetch validated documents
- [ ] Implement caching for test documents (avoid repeated API calls)
- [ ] Parse dataset structure (categories, documents, Q&A pairs, metadata)
- [ ] Validate dataset completeness (all required fields present)

**Subtask 4.4.2: Q&A Evaluation Framework**
- [ ] Create `evaluateChunkingQuality(chunks, qaData)` function
- [ ] Implement semantic search over chunks to answer test questions
- [ ] Calculate accuracy: correct_answers / total_questions
- [ ] Compare answers vs ground truth (fuzzy matching + semantic similarity)
- [ ] Generate per-question performance report

**Subtask 4.4.3: Category-Specific Test Suites**
- [ ] Historical documents test suite (📜 5-7 documents)
- [ ] Technical documents test suite (🔧 5-7 documents)
- [ ] Table-heavy documents test suite (📊 5-7 documents)
- [ ] Graph/image documents test suite (📈 5-7 documents)
- [ ] Run `compare-chunking-strategies` on each document
- [ ] Store results in `pipeline_comparison_metrics` with category tag

**Subtask 4.4.4: Performance Report Generation**
- [ ] Aggregate results by category
- [ ] Calculate metrics per category:
  - Chunking quality score (0-100)
  - Q&A accuracy (%)
  - Extraction precision/recall (tables, entities)
  - Processing time (avg, median, p95)
  - Cost per document (avg)
- [ ] Generate comparison report (Pipeline A vs B per category)
- [ ] Identify winning pipeline per document type
- [ ] Export report as JSON + CSV
- [ ] Email summary to admin

**Success Criteria**:
- ✅ All 20-28 test documents processed successfully
- ✅ Q&A accuracy measured for both pipelines
- ✅ Clear winner identified per category
- ✅ Cost/benefit analysis complete

---

### Milestone 5: Monitoring, Rollout & Cleanup
**Goal**: Production readiness and decision-making
**Estimated Time**: 4-5 hours
**Dependencies**: Milestone 4 completed
**Deployable**: ✅ Yes (final production release)

#### Task 5.1: Enhanced Logging & Monitoring
**Time**: 1.5 hours | **Status**: ⬜ Not Started | **Depends on**: None

- [ ] Add structured logging to all Pipeline B functions
  ```typescript
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    pipeline: 'B',
    function: 'upload-pdf-to-pool-landing-ai',
    document_id: docId,
    status: 'processing',
    step: 'landing_ai_parsing',
    duration_ms: 1234
  }));
  ```
- [ ] Create log query shortcuts in `PIPELINE_B_IMPLEMENTATION.md`
- [ ] Set up alerts for:
  - Pipeline B error rate > 5%
  - Nexla microservice downtime
  - Landing AI rate limiting
  - Cost exceeding $100/month

---

#### Task 5.2: Cost Tracking Dashboard
**Time**: 1.5 hours | **Status**: ⬜ Not Started | **Depends on**: Milestone 4

- [ ] Create `pipeline_costs` table:
  ```sql
  CREATE TABLE pipeline_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    pipeline TEXT CHECK (pipeline IN ('A', 'B')),
    documents_processed INT,
    total_cost_usd DECIMAL(10,2),
    avg_cost_per_doc DECIMAL(10,4)
  );
  ```
- [ ] Implement daily cost aggregation function
- [ ] Add cost chart to Admin Dashboard
- [ ] Add budget alert (>80% of $100/month limit)

---

#### Task 5.3: Pipeline Selection ML Training
**Time**: 2-3 hours | **Status**: ⬜ Not Started | **Depends on**: Milestone 4 completed

**Goal**: Addestrare un modello di classificazione per decidere automaticamente quale pipeline usare in base alle caratteristiche del documento.

**Subtask 5.3.1: Feature Extraction**
- [ ] Analizzare risultati di Milestone 4 per identificare pattern
- [ ] Estrarre features da ogni documento testato:
  - `has_tables` (boolean)
  - `table_count` (int)
  - `layout_complexity` (0-100, from Landing AI metadata)
  - `page_count` (int)
  - `has_images` (boolean)
  - `image_count` (int)
  - `text_density` (chars/page)
  - `bibliography_references` (count)
- [ ] Label each document with optimal pipeline (based on accuracy + cost)

**Subtask 5.3.2: Model Training**
- [ ] Prepare training dataset (80% test docs) and validation set (20%)
- [ ] Train classification model:
  - Option 1: Decision Tree (interpretable, fast)
  - Option 2: Logistic Regression (probability scores)
  - Option 3: Simple rule-based heuristic (if dataset too small)
- [ ] Evaluate model accuracy on validation set (target: >85%)
- [ ] Generate decision rules (human-readable)

**Subtask 5.3.3: Deploy Classification Edge Function**
- [ ] Create `supabase/functions/classify-document/index.ts`
- [ ] Input: document metadata (pre-extracted features)
- [ ] Output: `{ pipeline: 'A' | 'B', confidence: 0-1, reasoning: string }`
- [ ] Implement model inference (use trained weights/rules)
- [ ] Add logging for monitoring prediction accuracy
- [ ] Test on holdout set from Milestone 4

**Decision Logic Example**:
```typescript
function classifyDocument(features: DocumentFeatures): PipelineRecommendation {
  // Rule-based heuristic (can be replaced with trained model)
  if (features.table_count >= 3 || features.layout_complexity > 70) {
    return { pipeline: 'B', confidence: 0.9, reasoning: 'Complex layout or multiple tables detected' };
  }
  
  if (features.page_count < 10 && features.layout_complexity < 40) {
    return { pipeline: 'A', confidence: 0.85, reasoning: 'Simple document, cost optimization' };
  }
  
  // Borderline case - use cost/benefit
  const costDiff = PIPELINE_B_COST - PIPELINE_A_COST;
  const expectedAccuracyGain = estimateAccuracyGain(features); // from historical data
  
  if (expectedAccuracyGain * VALUE_PER_ACCURACY_POINT > costDiff) {
    return { pipeline: 'B', confidence: 0.6, reasoning: 'Expected accuracy gain justifies cost' };
  }
  
  return { pipeline: 'A', confidence: 0.7, reasoning: 'Default to cost-efficient pipeline' };
}
```

**Success Criteria**:
- ✅ Classification model achieves >85% accuracy on validation set
- ✅ Edge function deployed and tested
- ✅ Prediction reasoning is clear and interpretable

---

#### Task 5.4: Rollout Decision Matrix
**Time**: 1 hour | **Status**: ⬜ Not Started | **Depends on**: Milestone 4, Task 5.3

- [ ] Analyze A/B testing results from Milestone 4
- [ ] Calculate ROI:
  ```
  ROI = (Alignment_Score_Improvement * Value_Per_Point) / Extra_Cost
  ```
- [ ] Decision logic:
  ```
  IF alignment_improvement >= +8% AND cost_acceptable:
    → Rollout Pipeline B to 100%
  ELSE IF alignment_improvement >= +5% AND has_tables_frequency > 30%:
    → Hybrid mode (auto-select Pipeline B for complex docs)
  ELSE:
    → Keep Pipeline A as default, improve with Boundary-Aware Sliding Window
  ```
- [ ] Document decision in "Decision Log" section
- [ ] Update default `chunking_strategy` if rolling out

---

#### Task 5.5: Pipeline A Refactoring (if Pipeline B wins)
**Time**: 3-4 hours | **Status**: ⬜ Not Started | **Depends on**: Task 5.4 decision

**If Pipeline B becomes default:**
- [ ] Update all existing upload functions to use Pipeline B
- [ ] Mark Pipeline A functions as "legacy" in comments
- [ ] Add deprecation notices in UI
- [ ] Plan gradual migration of existing documents
- [ ] Archive old code after 30 days

**If Hybrid mode:**
- [ ] Implement auto-selection logic in shared module
- [ ] Update all upload entry points to use auto-selection
- [ ] Add override option in UI

---

#### Task 5.6: Documentation & Knowledge Transfer
**Time**: 1 hour | **Status**: ⬜ Not Started | **Depends on**: All milestones

- [ ] Update project README with Pipeline B explanation
- [ ] Create architecture diagram (Mermaid)
- [ ] Document Nexla microservice maintenance
- [ ] Document cost monitoring procedures
- [ ] Create troubleshooting guide
- [ ] Update API documentation
- [ ] Add inline code comments for future maintainers

---

## 🚨 Issues Log

### Active Issues
_None currently_

### Resolved Issues
_None yet_

---

## 📝 Decision Log

| Date | Decision | Rationale | Impact |
|------|----------|-----------|--------|
| 2025-01-18 | Use dual-pipeline approach | Faster implementation, A/B testing built-in, zero risk to Pipeline A | +2 days dev time, +$41/month infra cost |
| 2025-01-18 | Deploy Nexla on Railway | Free tier, auto-deploy, monitoring included | Railway vendor lock-in |
| 2025-01-18 | Feature branch `feature/pipeline-b` | Isolate work, easy context switching for Pipeline A fixes | Requires manual branch switching |

---

## 📊 Test Results

### Milestone 2 - End-to-End Testing
_To be filled after Task 2.5_

| PDF Type | Pipeline A Chunks | Pipeline B Chunks | Difference | Processing Time A | Processing Time B | Winner |
|----------|-------------------|-------------------|------------|-------------------|-------------------|--------|
| Simple text | - | - | - | - | - | - |
| Multi-column + tables | - | - | - | - | - | - |
| Image-heavy | - | - | - | - | - | - |

### Milestone 4 - A/B Testing Results
_To be filled after Task 4.4_

**Aggregate Metrics**:
- Total tests: -
- Pipeline A wins: -
- Pipeline B wins: -
- Ties: -
- Avg alignment score improvement: -
- Avg cost difference: $-

---

## 🔗 Quick Links

**Edge Functions**:
- [upload-pdf-to-pool-landing-ai logs](Cloud → Functions → upload-pdf-to-pool-landing-ai → Logs)
- [compare-chunking-strategies logs](Cloud → Functions → compare-chunking-strategies → Logs)

**External Services**:
- [Nexla microservice (Railway)](https://railway.app/project/nexla-chunker)
- [Landing AI dashboard](https://app.landing.ai/)

**Database Queries**:
```sql
-- Check Pipeline B documents
SELECT id, file_name, chunking_strategy, processing_status, created_at 
FROM knowledge_documents 
WHERE chunking_strategy = 'landing_ai_nexla' 
ORDER BY created_at DESC 
LIMIT 20;

-- Check Pipeline B chunks
SELECT COUNT(*), AVG(LENGTH(content)) as avg_length
FROM agent_knowledge 
WHERE chunking_metadata->>'strategy' = 'landing_ai_nexla';

-- Daily cost report
SELECT date, pipeline, documents_processed, total_cost_usd 
FROM pipeline_costs 
WHERE date >= CURRENT_DATE - INTERVAL '7 days' 
ORDER BY date DESC;
```

---

## 🎯 Next Session Quick Start

**To resume work after interruption:**

1. **Check Status Dashboard** (top of file) for current phase
2. **Read "Quick Resume Context"** for last activity
3. **Find next unchecked task** in current milestone
4. **Review dependencies** before starting
5. **Update context** before switching to Pipeline A work

**Prompt Template for AI**:
```
Sto lavorando su Pipeline B. Ultimo task completato: [TASK_NUMBER]. 
Prossimo task: [TASK_NUMBER]. Ho bisogno di [SPECIFIC_HELP].
```

---

## 📈 Progress Tracker

```
Milestone 1: [▱▱▱▱▱▱] 0/6 tasks (0%)
Milestone 2: [▱▱▱▱▱▱] 0/6 tasks (0%)
Milestone 3: [▱▱▱▱▱] 0/5 tasks (0%)
Milestone 4: [▱▱▱▱▱] 0/5 tasks (0%)
Milestone 5: [▱▱▱▱▱] 0/5 tasks (0%)

Overall: [▱▱▱▱▱▱▱▱▱▱] 0/36 tasks (0%)
```

---

**Last Updated**: 2025-01-18
**Maintained By**: Project Team
**AI Assistant**: Lovable (context-aware via this file)
