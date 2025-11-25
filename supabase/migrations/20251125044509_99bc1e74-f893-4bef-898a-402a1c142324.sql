-- Pipeline C: Database Schema
-- Tabelle completamente disaccoppiate da Pipeline A e B

-- Storage bucket per Pipeline C
INSERT INTO storage.buckets (id, name, public)
VALUES ('pipeline-c-uploads', 'pipeline-c-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Tabella documenti Pipeline C
CREATE TABLE IF NOT EXISTS pipeline_c_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'pipeline-c-uploads',
  file_size_bytes INTEGER,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'ingested',
  -- Possibili valori: ingested, processing, chunked, ready, failed
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  error_message TEXT
);

-- Indice per query per status
CREATE INDEX IF NOT EXISTS idx_pipeline_c_documents_status 
ON pipeline_c_documents(status) 
WHERE status IN ('ingested', 'processing', 'chunked');

-- Tabella chunks Pipeline C (con metadata arricchiti)
CREATE TABLE IF NOT EXISTS pipeline_c_chunks_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pipeline_c_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  
  -- Metadata arricchiti (dal PDF Content-Aware Chunking)
  chunk_type TEXT NOT NULL, -- narrative, technical, reference
  semantic_weight NUMERIC CHECK (semantic_weight >= 0 AND semantic_weight <= 1),
  position TEXT, -- intro, body, conclusion
  headings JSONB, -- Array di heading hierarchy
  keywords TEXT[], -- Parole chiave estratte
  document_section TEXT,
  page_number INTEGER,
  visual_grounding JSONB, -- { left, top, right, bottom }
  
  -- Embedding
  embedding vector(1536),
  embedding_status TEXT DEFAULT 'pending', -- pending, processing, ready, failed
  embedding_error TEXT,
  embedded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(document_id, chunk_index)
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_pipeline_c_chunks_document_status 
ON pipeline_c_chunks_raw(document_id, embedding_status);

CREATE INDEX IF NOT EXISTS idx_pipeline_c_chunks_embedding_status 
ON pipeline_c_chunks_raw(embedding_status) 
WHERE embedding_status IN ('pending', 'processing');

-- GIN index per keywords array
CREATE INDEX IF NOT EXISTS idx_pipeline_c_chunks_keywords 
ON pipeline_c_chunks_raw USING GIN(keywords);

-- Tabella agent knowledge Pipeline C
CREATE TABLE IF NOT EXISTS pipeline_c_agent_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES pipeline_c_chunks_raw(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, chunk_id)
);

-- Indice per query per agent
CREATE INDEX IF NOT EXISTS idx_pipeline_c_agent_knowledge_agent 
ON pipeline_c_agent_knowledge(agent_id, is_active) 
WHERE is_active = true;

-- RLS Policies (identiche a Pipeline B)
ALTER TABLE pipeline_c_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_c_chunks_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_c_agent_knowledge ENABLE ROW LEVEL SECURITY;

-- Documents: tutti gli utenti autenticati possono leggere/modificare
CREATE POLICY "Authenticated users can manage pipeline_c documents"
ON pipeline_c_documents FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Chunks: tutti gli utenti autenticati possono leggere/modificare
CREATE POLICY "Authenticated users can manage pipeline_c chunks"
ON pipeline_c_chunks_raw FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Agent Knowledge: gli utenti possono gestire knowledge dei propri agenti
CREATE POLICY "Users can manage their agents pipeline_c knowledge"
ON pipeline_c_agent_knowledge FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM agents
    WHERE agents.id = pipeline_c_agent_knowledge.agent_id
    AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM agents
    WHERE agents.id = pipeline_c_agent_knowledge.agent_id
    AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  )
);