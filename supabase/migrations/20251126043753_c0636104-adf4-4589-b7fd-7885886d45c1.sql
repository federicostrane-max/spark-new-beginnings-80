-- =====================================================
-- PIPELINE A: LlamaParse + Small-to-Big Recursive Retrieval
-- Database Schema Migration
-- =====================================================

-- 1. Storage bucket per Pipeline A uploads
INSERT INTO storage.buckets (id, name, public) 
VALUES ('pipeline-a-uploads', 'pipeline-a-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Tabella principale documenti Pipeline A
CREATE TABLE IF NOT EXISTS pipeline_a_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_bucket TEXT DEFAULT 'pipeline-a-uploads',
  file_size_bytes INTEGER,
  status TEXT DEFAULT 'ingested' CHECK (status IN ('ingested', 'processing', 'chunked', 'ready', 'failed')),
  llamaparse_job_id TEXT,
  page_count INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  source_type TEXT DEFAULT 'pdf'
);

-- 3. Tabella chunks Pipeline A con supporto Recursive Retrieval
CREATE TABLE IF NOT EXISTS pipeline_a_chunks_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pipeline_a_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  original_content TEXT,
  summary TEXT,
  chunk_type TEXT DEFAULT 'text',
  is_atomic BOOLEAN DEFAULT false,
  heading_hierarchy JSONB,
  page_number INTEGER,
  embedding VECTOR(1536),
  embedding_status TEXT DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'processing', 'ready', 'failed')),
  embedded_at TIMESTAMPTZ,
  embedding_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabella knowledge agente-specifico Pipeline A
CREATE TABLE IF NOT EXISTS pipeline_a_agent_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES pipeline_a_chunks_raw(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, chunk_id)
);

-- 5. Indexes per performance
CREATE INDEX IF NOT EXISTS idx_pipeline_a_docs_status ON pipeline_a_documents(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_a_docs_llamaparse_job ON pipeline_a_documents(llamaparse_job_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_a_chunks_doc ON pipeline_a_chunks_raw(document_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_a_chunks_status ON pipeline_a_chunks_raw(embedding_status);
CREATE INDEX IF NOT EXISTS idx_pipeline_a_chunks_is_atomic ON pipeline_a_chunks_raw(is_atomic) WHERE is_atomic = true;
CREATE INDEX IF NOT EXISTS idx_pipeline_a_agent_knowledge_agent ON pipeline_a_agent_knowledge(agent_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_a_agent_knowledge_chunk ON pipeline_a_agent_knowledge(chunk_id);

-- 6. RLS Policies per Pipeline A
ALTER TABLE pipeline_a_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_a_chunks_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_a_agent_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on pipeline_a_documents" ON pipeline_a_documents;
CREATE POLICY "Allow all operations on pipeline_a_documents" 
ON pipeline_a_documents FOR ALL 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on pipeline_a_chunks_raw" ON pipeline_a_chunks_raw;
CREATE POLICY "Allow all operations on pipeline_a_chunks_raw" 
ON pipeline_a_chunks_raw FOR ALL 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "Users can manage their agents pipeline_a knowledge" ON pipeline_a_agent_knowledge;
CREATE POLICY "Users can manage their agents pipeline_a knowledge" 
ON pipeline_a_agent_knowledge FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM agents 
    WHERE agents.id = pipeline_a_agent_knowledge.agent_id 
    AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  )
) 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM agents 
    WHERE agents.id = pipeline_a_agent_knowledge.agent_id 
    AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  )
);