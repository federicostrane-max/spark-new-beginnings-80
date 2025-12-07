import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DOCUMENTATION = `
================================================================================
                    SYSTEM ARCHITECTURE DOCUMENTATION
                    Multi-Agent RAG Platform v2.0
================================================================================

DATA: ${new Date().toLocaleDateString('it-IT')}

================================================================================
                              INDICE
================================================================================

1. PANORAMICA SISTEMA
2. ARCHITETTURA AGENTI CUSTOM
3. PIPELINE RAG "A-HYBRID" (GOLD STANDARD)
4. SISTEMA DI RICERCA SEMANTICA
5. VISUAL ENRICHMENT
6. AGENT CHAT SYSTEM
7. SCHEMA DATABASE
8. EDGE FUNCTIONS
9. CONFIGURAZIONI E SEGRETI

================================================================================
                         1. PANORAMICA SISTEMA
================================================================================

Sistema multi-agente RAG (Retrieval-Augmented Generation) che permette di:
- Creare agenti AI personalizzati con knowledge base dedicate
- Processare documenti PDF, Markdown e GitHub repos
- Eseguire ricerca semantica ibrida (embedding + keyword)
- Arricchimento visuale automatico di tabelle/grafici/immagini
- Benchmark automatizzato per valutazione qualita RAG

STACK TECNOLOGICO:
- Frontend: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- Backend: Supabase (PostgreSQL + Edge Functions + Storage)
- LLM: Claude (Anthropic), Gemini (Google), DeepSeek, OpenRouter
- Embedding: OpenAI text-embedding-3-small (1536 dimensioni)
- OCR/Parsing: LlamaParse + Claude Vision fallback

================================================================================
                    2. ARCHITETTURA AGENTI CUSTOM
================================================================================

TABELLA: agents
---------------
- id: UUID (PK)
- name: Nome agente
- slug: Identificativo URL-friendly
- description: Descrizione funzionale
- system_prompt: Prompt di sistema (istruzioni comportamentali)
- llm_provider: anthropic | google | deepseek | openrouter | openai
- ai_model: Modello specifico (es. claude-sonnet-4-5, gemini-3-pro-preview)
- avatar: Emoji rappresentativo
- active: Stato attivazione

TABELLA: agent_config
----------------------
- agent_id: FK -> agents.id
- custom_system_prompt: Override prompt (opzionale)

TABELLA: agent_knowledge
------------------------
- agent_id: FK -> agents.id
- content: Testo chunk
- embedding: vector(1536)
- document_name: Nome documento origine
- category: Categoria classificazione
- chunk_type: text | table | visual | list

FLUSSO CREAZIONE AGENTE:
1. Utente compila form (nome, descrizione, prompt, modello)
2. Sistema crea record in agents
3. Utente assegna documenti dalla Document Pool
4. Sistema sincronizza chunks in agent_knowledge

================================================================================
                3. PIPELINE RAG "A-HYBRID" (GOLD STANDARD)
================================================================================

Pipeline designata come standard aziendale dopo validazione scientifica.
Combina: LlamaParse + Multimodal Vision + Small-to-Big + Hybrid Search

FASE 1: INGESTION (pipeline-a-hybrid-ingest-pdf)
-------------------------------------------------
Input: File PDF caricato in Storage
Output: Record in pipeline_a_hybrid_documents (status: 'ingested')

Processo:
1. Upload file in bucket 'pipeline-a-uploads'
2. Creazione record documento con metadata
3. Trigger automatico fase successiva via EdgeRuntime.waitUntil()

FASE 2: BATCH SPLITTING (split-pdf-into-batches)
-------------------------------------------------
Input: Documento 'ingested'
Output: Jobs in processing_jobs table

Processo:
1. Download PDF da Storage
2. Split in batch da 10 pagine con pdf-lib
3. Upload batch in 'pipeline-a-batches' bucket
4. Creazione job per ogni batch
5. Trigger process-pdf-batch per primo job

FASE 3: BATCH PROCESSING (process-pdf-batch)
----------------------------------------------
Input: Job da processing_jobs
Output: Chunks in pipeline_a_hybrid_chunks_raw

Processo per ogni batch:
1. Invio a LlamaParse con configurazione:
   - auto_mode: true
   - auto_mode_trigger_on_table_in_page: true
   - auto_mode_trigger_on_image_in_page: true
   - output_format: json_detailed
   
2. Parsing elementi dal JSON:
   - Testo: chunking semantico (600-1200 caratteri)
   - Tabelle: preservazione struttura Markdown
   - Immagini: creazione placeholder + job visual enrichment
   
3. Assegnazione chunk_type semantico:
   - cover_page, balance_sheet, income_statement
   - cash_flow_statement, exhibit, notes_disclosure

4. Salvataggio chunks con embedding_status: 'pending'

FASE 4: VISUAL ENRICHMENT (process-vision-queue)
-------------------------------------------------
Input: Jobs in visual_enrichment_queue
Output: Descrizioni immagini in chunks

Processo:
1. Download immagine da Storage
2. Analisi contesto documento (domain detection)
3. Generazione prompt domain-specific
4. Invocazione Claude Vision per descrizione
5. Update chunk con descrizione (sostituisce placeholder)

Domini supportati:
- trading: Focus su candlestick, indicatori, livelli prezzo
- finance: Bilanci, metriche finanziarie, tabelle
- architecture: Planimetrie, dimensioni, annotazioni
- medical: Valori diagnostici, referti
- legal: Date, firme, clausole
- science: Formule, grafici, dati sperimentali

FASE 5: EMBEDDING GENERATION (pipeline-a-hybrid-generate-embeddings)
---------------------------------------------------------------------
Input: Chunks con embedding_status: 'pending'
Output: Chunks con embedding vector

Processo:
1. Batch di 50 chunks per invocazione
2. Chiamata OpenAI text-embedding-3-small
3. Salvataggio embedding (1536 dimensioni)
4. Self-continuation se altri chunks pending
5. Transizione documento a 'ready' quando completo

FASE 6: AGENT SYNC (pipeline-a-hybrid-sync-agent)
--------------------------------------------------
Input: Documento 'ready' + Agent ID
Output: Link in pipeline_a_hybrid_agent_knowledge

Processo:
1. Identificazione chunks del documento
2. Creazione associazioni agent-chunk
3. Chunks disponibili per ricerca semantica

================================================================================
                    4. SISTEMA DI RICERCA SEMANTICA
================================================================================

EDGE FUNCTION: semantic-search
-------------------------------

ARCHITETTURA HYBRID SEARCH:
Esecuzione parallela di due strategie con merge risultati

1. RICERCA SEMANTICA (match_documents RPC)
   - Embedding query con text-embedding-3-small
   - Cosine similarity su vector column
   - Threshold configurabile (default: 0.10)
   - Pre-filtering opzionale per document_name

2. RICERCA KEYWORD (keyword_search_documents RPC)
   - PostgreSQL Full-Text Search (FTS)
   - Tokenizzazione e stemming
   - Ranking ts_rank

3. MERGE & DEDUP
   - Unione risultati con label search_type
   - Deduplicazione per chunk_id
   - Scoring combinato

QUERY EXPANSION (expand-query-llm):
- Cache persistente in query_expansion_cache
- LLM expansion con Gemini Flash Lite
- Aggiunta termini GAAP/IFRS per query finanziarie
- Fallback a dizionario statico

QUERY-AWARE CHUNK BOOSTING:
- Classificazione intent query (filing_metadata, balance_sheet_metric, etc.)
- Boost multiplier per chunk_type semantico
- Re-ranking post-retrieval

================================================================================
                        5. VISUAL ENRICHMENT
================================================================================

TABELLA: visual_enrichment_queue
---------------------------------
- id: UUID (PK)
- document_id: FK -> pipeline_a_hybrid_documents
- chunk_id: FK -> pipeline_a_hybrid_chunks_raw
- image_path: Path in Storage
- status: pending | processing | completed | failed
- description: Output Claude Vision

PROMPT DOMAINS (visionEnhancer.ts):
------------------------------------
Ogni dominio ha prompt specializzato con:
- Limite caratteri embedded (800 max)
- Focus specifico per tipo documento
- Formato strutturato [TYPE][TITLE][PAGE][CONTEXT][DATA]
- Proibizione narrative generiche

CONTEXT ANALYZER (contextAnalyzer.ts):
---------------------------------------
Analizza sample testo documento per determinare:
- domain: trading | finance | architecture | medical | legal | science
- focus_elements: Cosa cercare nelle immagini
- terminology: Vocabolario specifico
- verbosity: Livello dettaglio richiesto

================================================================================
                        6. AGENT CHAT SYSTEM
================================================================================

EDGE FUNCTION: agent-chat
--------------------------

FLUSSO CONVERSAZIONE:
1. Ricezione messaggio utente
2. Caricamento system_prompt agente
3. Ricerca semantica in agent_knowledge
4. Costruzione context con chunks rilevanti
5. Chiamata LLM provider (streaming)
6. Salvataggio messaggi in agent_messages

PROVIDER SUPPORTATI:
- anthropic: Claude Sonnet 4.5, Haiku
- google: Gemini 3 Pro Preview, Flash
- deepseek: DeepSeek Chat
- openrouter: Accesso multi-modello
- openai: GPT-4, GPT-3.5

FUNCTION CALLING (Google Gemini):
- Tool: retrieve_relevant_documents
- Sanitizzazione automatica risultati
- Fallback su errori API

STREAMING:
- Server-Sent Events (SSE)
- Chunked transfer encoding
- Real-time UI update

================================================================================
                        7. SCHEMA DATABASE
================================================================================

PIPELINE A-HYBRID TABLES:
--------------------------
pipeline_a_hybrid_documents
  - id, file_name, file_path, status, folder
  - extraction_mode, extraction_attempts
  - llamaparse_job_id, page_count
  - processing_metadata

pipeline_a_hybrid_chunks_raw
  - id, document_id, chunk_index, content
  - chunk_type, embedding, embedding_status
  - heading_hierarchy, page_number, summary

pipeline_a_hybrid_agent_knowledge
  - id, agent_id, chunk_id, is_active, synced_at

processing_jobs
  - id, document_id, batch_index, total_batches
  - status, batch_path, error_message

visual_enrichment_queue
  - id, document_id, chunk_id, image_path
  - status, description, error_message

BENCHMARK TABLES:
------------------
benchmark_datasets
  - id, suite_category, file_name, question
  - ground_truth, document_id, storage_path

benchmark_results
  - id, run_id, question, ground_truth
  - agent_response, correct, reason

benchmark_jobs_queue
  - id, run_id, question_id, status, result

AGENT TABLES:
--------------
agents, agent_config, agent_knowledge
agent_conversations, agent_messages
agent_message_attachments

================================================================================
                        8. EDGE FUNCTIONS
================================================================================

INGESTION:
- pipeline-a-hybrid-ingest-pdf: Upload e registrazione PDF
- pipeline-a-hybrid-ingest-markdown: Markdown/GitHub
- split-pdf-into-batches: Splitting pagine
- process-pdf-batch: Processing LlamaParse

PROCESSING:
- pipeline-a-hybrid-process-chunks: Chunking semantico
- pipeline-a-hybrid-generate-embeddings: Generazione embedding
- process-vision-queue: Visual enrichment
- aggregate-document-batches: Aggregazione finale

SYNC:
- pipeline-a-hybrid-sync-agent: Sincronizzazione agente
- assign-benchmark-chunks: Assegnazione benchmark

SEARCH:
- semantic-search: Ricerca ibrida
- expand-query-llm: Query expansion

CHAT:
- agent-chat: Conversazione agente
- deepseek-chat: Provider DeepSeek
- openrouter-chat: Provider OpenRouter

BENCHMARK:
- run-benchmark: Esecuzione benchmark
- process-benchmark-job: Processing singola domanda
- evaluate-answer: Valutazione LLM Judge
- provision-benchmark-datasets: Provisioning dataset

UTILITY:
- ocr-image: OCR singola immagine
- text-to-speech: Sintesi vocale
- transcribe-audio: Trascrizione audio
- web-search: Ricerca web

================================================================================
                    9. CONFIGURAZIONI E SEGRETI
================================================================================

SECRETS RICHIESTI:
-------------------
- OPENAI_API_KEY: Embedding generation
- ANTHROPIC_API_KEY: Claude Vision + Chat
- GOOGLE_AI_STUDIO_API_KEY: Gemini models
- LLAMA_CLOUD_API_KEY: LlamaParse parsing
- DEEPSEEK_API_KEY: DeepSeek chat (opzionale)
- OPENROUTER_API_KEY: OpenRouter access (opzionale)

CRON JOBS (pg_cron):
---------------------
- process-vision-queue: Ogni minuto
- pipeline-a-hybrid-generate-embeddings: Ogni 5 minuti
- process-batch-jobs-queue: Ogni minuto
- assign-benchmark-chunks: Ogni 5 minuti

PERFORMANCE METRICS:
---------------------
- Tempo processing PDF piccolo (<10 pagine): 30-60 secondi
- Tempo processing PDF grande (100+ pagine): 5-15 minuti
- Visual enrichment per immagine: 2-5 secondi
- Embedding batch (50 chunks): 3-5 secondi
- Ricerca semantica: 100-300ms

================================================================================
                              FINE DOCUMENTO
================================================================================
`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[download-system-docs] Generating PDF documentation...');

    // Create a simple text-based "PDF" (actually plain text for now)
    // In production, you'd use a proper PDF library
    const content = DOCUMENTATION;
    
    const headers = {
      ...corsHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="SYSTEM_ARCHITECTURE_DOCUMENTATION.txt"',
    };

    return new Response(content, { headers });

  } catch (error) {
    console.error('[download-system-docs] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Download error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
