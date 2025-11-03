-- ===================================
-- FASE 1: KNOWLEDGE POOL + VALIDATION
-- ===================================

-- Table for shared knowledge documents pool
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic document info
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  source_url TEXT, -- Original URL if from web search
  search_query TEXT, -- Original search query that found this doc
  
  -- Validation fields (NEW)
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'validating', 'validated', 'validation_failed')),
  validation_reason TEXT, -- Why validation failed or passed
  validation_date TIMESTAMPTZ,
  text_length INTEGER, -- Extracted text length for quick check
  
  -- Processing fields
  processing_status TEXT NOT NULL DEFAULT 'downloaded' CHECK (processing_status IN ('downloaded', 'validating', 'validated', 'processing', 'ready_for_assignment', 'validation_failed', 'processing_failed')),
  
  -- AI-generated metadata (after validation passes)
  ai_summary TEXT, -- Brief summary for preview
  keywords TEXT[], -- Extracted keywords
  topics TEXT[], -- Main topics covered
  complexity_level TEXT CHECK (complexity_level IN ('basic', 'intermediate', 'advanced')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Table for linking agents to shared documents
CREATE TABLE agent_document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  
  -- Link metadata
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('manual', 'auto_suggested', 'ai_assigned')),
  confidence_score FLOAT, -- AI confidence in this assignment (0-1)
  assigned_by UUID, -- User who made the assignment (NULL for AI)
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(agent_id, document_id)
);

-- Cache table for tracking document processing
CREATE TABLE document_processing_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  
  -- Processing stages
  validation_started_at TIMESTAMPTZ,
  validation_completed_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  
  -- Chunk processing (for existing chunk system)
  total_chunks INTEGER,
  processed_chunks INTEGER DEFAULT 0,
  
  -- Error tracking
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Extend agent_knowledge table (RETROCOMPATIBLE - no breaking changes)
ALTER TABLE agent_knowledge 
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'direct_upload' CHECK (source_type IN ('direct_upload', 'shared_pool')),
  ADD COLUMN IF NOT EXISTS pool_document_id UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX idx_knowledge_documents_status ON knowledge_documents(processing_status);
CREATE INDEX idx_knowledge_documents_validation ON knowledge_documents(validation_status);
CREATE INDEX idx_knowledge_documents_search_query ON knowledge_documents(search_query);
CREATE INDEX idx_agent_document_links_agent ON agent_document_links(agent_id);
CREATE INDEX idx_agent_document_links_document ON agent_document_links(document_id);
CREATE INDEX idx_agent_knowledge_pool_doc ON agent_knowledge(pool_document_id);
CREATE INDEX idx_document_processing_cache_doc ON document_processing_cache(document_id);

-- RLS Policies
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_processing_cache ENABLE ROW LEVEL SECURITY;

-- Knowledge documents: authenticated users can read all
CREATE POLICY "Authenticated users can read knowledge documents"
  ON knowledge_documents FOR SELECT
  TO authenticated
  USING (true);

-- Knowledge documents: authenticated users can insert
CREATE POLICY "Authenticated users can insert knowledge documents"
  ON knowledge_documents FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Knowledge documents: authenticated users can update
CREATE POLICY "Authenticated users can update knowledge documents"
  ON knowledge_documents FOR UPDATE
  TO authenticated
  USING (true);

-- Knowledge documents: authenticated users can delete
CREATE POLICY "Authenticated users can delete knowledge documents"
  ON knowledge_documents FOR DELETE
  TO authenticated
  USING (true);

-- Agent document links: users can view links for their agents
CREATE POLICY "Users can view document links for their agents"
  ON agent_document_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents 
      WHERE agents.id = agent_document_links.agent_id 
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

-- Agent document links: users can create links for their agents
CREATE POLICY "Users can create document links for their agents"
  ON agent_document_links FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents 
      WHERE agents.id = agent_document_links.agent_id 
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

-- Agent document links: users can delete links for their agents
CREATE POLICY "Users can delete document links for their agents"
  ON agent_document_links FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agents 
      WHERE agents.id = agent_document_links.agent_id 
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

-- Processing cache: authenticated users can read all
CREATE POLICY "Authenticated users can read processing cache"
  ON document_processing_cache FOR SELECT
  TO authenticated
  USING (true);

-- Processing cache: authenticated users can insert/update
CREATE POLICY "Authenticated users can insert processing cache"
  ON document_processing_cache FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update processing cache"
  ON document_processing_cache FOR UPDATE
  TO authenticated
  USING (true);

-- Trigger for updated_at on knowledge_documents
CREATE OR REPLACE FUNCTION update_knowledge_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_documents_updated_at
  BEFORE UPDATE ON knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_knowledge_documents_updated_at();

-- Trigger for updated_at on document_processing_cache
CREATE OR REPLACE FUNCTION update_processing_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER processing_cache_updated_at
  BEFORE UPDATE ON document_processing_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_processing_cache_updated_at();