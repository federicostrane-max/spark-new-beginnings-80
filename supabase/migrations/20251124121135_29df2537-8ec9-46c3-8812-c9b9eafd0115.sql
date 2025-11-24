-- Pipeline B: Complete new document processing system
-- Tables are completely independent from existing system

-- 1. Main documents table for Pipeline B
CREATE TABLE IF NOT EXISTS pipeline_b_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'github', 'markdown', 'text')),
  file_name TEXT NOT NULL,
  file_path TEXT, -- Storage path for PDFs
  storage_bucket TEXT, -- Bucket name for PDFs
  full_text TEXT, -- Full text for GitHub/text documents
  repo_url TEXT, -- GitHub repository URL
  repo_path TEXT, -- Path within repository
  file_size_bytes INTEGER,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'ingested' CHECK (status IN ('ingested', 'processing', 'chunked', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- 2. Raw chunks from Landing AI (before embedding)
CREATE TABLE IF NOT EXISTS pipeline_b_chunks_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pipeline_b_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_type TEXT NOT NULL DEFAULT 'text', -- text, table, list, code_block, header
  chunk_index INTEGER NOT NULL,
  page_number INTEGER,
  visual_grounding JSONB, -- Bounding boxes from Landing AI
  embedding vector(1536), -- OpenAI text-embedding-3-small
  embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'processing', 'ready', 'failed')),
  embedding_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  embedded_at TIMESTAMPTZ
);

-- 3. Agent-specific knowledge (synced from chunks_raw)
CREATE TABLE IF NOT EXISTS pipeline_b_agent_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES pipeline_b_chunks_raw(id) ON DELETE CASCADE,
  synced_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(agent_id, chunk_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pipeline_b_documents_status ON pipeline_b_documents(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_b_chunks_embedding_status ON pipeline_b_chunks_raw(embedding_status);
CREATE INDEX IF NOT EXISTS idx_pipeline_b_chunks_document ON pipeline_b_chunks_raw(document_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_b_chunks_embedding ON pipeline_b_chunks_raw USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_pipeline_b_agent_knowledge_agent ON pipeline_b_agent_knowledge(agent_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pipeline_b_agent_knowledge_chunk ON pipeline_b_agent_knowledge(chunk_id);

-- RLS Policies
ALTER TABLE pipeline_b_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_b_chunks_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_b_agent_knowledge ENABLE ROW LEVEL SECURITY;

-- Documents: authenticated users can read/write
CREATE POLICY "Authenticated users can manage pipeline_b_documents"
  ON pipeline_b_documents FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Chunks: authenticated users can read/write
CREATE POLICY "Authenticated users can manage pipeline_b_chunks_raw"
  ON pipeline_b_chunks_raw FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Agent knowledge: users can only access their agents' knowledge
CREATE POLICY "Users can view their agents pipeline_b knowledge"
  ON pipeline_b_agent_knowledge FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = pipeline_b_agent_knowledge.agent_id
        AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

CREATE POLICY "Users can manage their agents pipeline_b knowledge"
  ON pipeline_b_agent_knowledge FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = pipeline_b_agent_knowledge.agent_id
        AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = pipeline_b_agent_knowledge.agent_id
        AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );