-- Create pdf_download_queue table
CREATE TABLE pdf_download_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  
  -- Dati estratti dalla tabella markdown dell'agente
  expected_title TEXT NOT NULL,
  expected_author TEXT,
  url TEXT NOT NULL,
  source TEXT,
  year TEXT,
  search_query TEXT NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',
  download_attempts INT DEFAULT 0,
  
  -- Risultati
  document_id UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  downloaded_file_name TEXT,
  validation_result JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  
  CONSTRAINT valid_status CHECK (status IN ('pending', 'downloading', 'validating', 'completed', 'failed'))
);

-- Create indexes for performance
CREATE INDEX idx_queue_conversation ON pdf_download_queue(conversation_id);
CREATE INDEX idx_queue_status ON pdf_download_queue(status);
CREATE INDEX idx_queue_created ON pdf_download_queue(created_at DESC);

-- Enable RLS
ALTER TABLE pdf_download_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view download queue for their own conversations
CREATE POLICY "Users can view own download queue"
  ON pdf_download_queue FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM agent_conversations WHERE user_id = auth.uid()::text
    )
  );

-- RLS Policy: System can insert into queue
CREATE POLICY "System can insert queue entries"
  ON pdf_download_queue FOR INSERT
  WITH CHECK (true);

-- RLS Policy: System can update queue entries
CREATE POLICY "System can update queue entries"
  ON pdf_download_queue FOR UPDATE
  USING (true);