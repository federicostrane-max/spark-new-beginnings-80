-- Tabella per tracciare le query di ricerca eseguite per ogni conversazione
CREATE TABLE IF NOT EXISTS search_query_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  original_topic TEXT NOT NULL,
  executed_query TEXT NOT NULL,
  query_variant_index INTEGER NOT NULL,
  results_found INTEGER DEFAULT 0,
  pdfs_downloaded INTEGER DEFAULT 0,
  pdfs_failed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, executed_query)
);

-- Index per performance
CREATE INDEX IF NOT EXISTS idx_search_query_history_conversation 
  ON search_query_history(conversation_id);

-- RLS policies
ALTER TABLE search_query_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their search history"
  ON search_query_history FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM agent_conversations 
      WHERE user_id = auth.uid()::text
    )
  );

CREATE POLICY "System can insert search history"
  ON search_query_history FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update search history"
  ON search_query_history FOR UPDATE
  USING (true);