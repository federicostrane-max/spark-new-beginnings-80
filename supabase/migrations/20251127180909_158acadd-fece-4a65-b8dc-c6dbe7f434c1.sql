-- Pipeline A-Hybrid Documents Table
CREATE TABLE pipeline_a_hybrid_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  storage_bucket TEXT DEFAULT 'pipeline-a-uploads',
  file_size_bytes INTEGER,
  page_count INTEGER,
  folder TEXT,
  source_type TEXT DEFAULT 'pdf',
  status TEXT DEFAULT 'ingested' CHECK (status IN ('ingested', 'processing', 'chunked', 'ready', 'failed')),
  error_message TEXT,
  llamaparse_job_id TEXT,
  processing_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Pipeline A-Hybrid Chunks Raw Table
CREATE TABLE pipeline_a_hybrid_chunks_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pipeline_a_hybrid_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  original_content TEXT,
  summary TEXT,
  chunk_type TEXT DEFAULT 'text',
  is_atomic BOOLEAN DEFAULT false,
  page_number INTEGER,
  heading_hierarchy JSONB,
  embedding vector(1536),
  embedding_status TEXT DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'processing', 'ready', 'failed')),
  embedding_error TEXT,
  embedded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Pipeline A-Hybrid Agent Knowledge Table
CREATE TABLE pipeline_a_hybrid_agent_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES pipeline_a_hybrid_chunks_raw(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, chunk_id)
);

-- Indexes for performance
CREATE INDEX idx_pipeline_a_hybrid_documents_status ON pipeline_a_hybrid_documents(status);
CREATE INDEX idx_pipeline_a_hybrid_documents_folder ON pipeline_a_hybrid_documents(folder);
CREATE INDEX idx_pipeline_a_hybrid_chunks_document_id ON pipeline_a_hybrid_chunks_raw(document_id);
CREATE INDEX idx_pipeline_a_hybrid_chunks_embedding_status ON pipeline_a_hybrid_chunks_raw(embedding_status);
CREATE INDEX idx_pipeline_a_hybrid_agent_knowledge_agent_id ON pipeline_a_hybrid_agent_knowledge(agent_id);
CREATE INDEX idx_pipeline_a_hybrid_agent_knowledge_chunk_id ON pipeline_a_hybrid_agent_knowledge(chunk_id);

-- RLS Policies
ALTER TABLE pipeline_a_hybrid_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_a_hybrid_chunks_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_a_hybrid_agent_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on pipeline_a_hybrid_documents" ON pipeline_a_hybrid_documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on pipeline_a_hybrid_chunks_raw" ON pipeline_a_hybrid_chunks_raw FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage their agents pipeline_a_hybrid knowledge" ON pipeline_a_hybrid_agent_knowledge FOR ALL 
  USING (EXISTS (SELECT 1 FROM agents WHERE agents.id = pipeline_a_hybrid_agent_knowledge.agent_id AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)))
  WITH CHECK (EXISTS (SELECT 1 FROM agents WHERE agents.id = pipeline_a_hybrid_agent_knowledge.agent_id AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)));