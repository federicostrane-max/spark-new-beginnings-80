-- Create table for long response tracking with background processing
CREATE TABLE agent_long_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES agent_conversations(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
  user_id TEXT NOT NULL,
  message_id UUID REFERENCES agent_messages(id) ON DELETE CASCADE NOT NULL,
  
  -- Status tracking
  status TEXT DEFAULT 'generating' NOT NULL CHECK (status IN ('generating', 'completed', 'failed')),
  
  -- Response chunks stored as JSONB array
  response_chunks JSONB DEFAULT '[]'::jsonb NOT NULL,
  current_chunk_index INTEGER DEFAULT 0,
  total_characters INTEGER DEFAULT 0,
  
  -- Metadata
  started_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  generation_time_seconds INTEGER,
  
  -- LLM info
  llm_provider TEXT,
  llm_model TEXT,
  total_tokens_used INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_long_responses_conversation ON agent_long_responses(conversation_id);
CREATE INDEX idx_long_responses_status ON agent_long_responses(status);
CREATE INDEX idx_long_responses_user ON agent_long_responses(user_id);
CREATE INDEX idx_long_responses_message ON agent_long_responses(message_id);

-- Enable RLS
ALTER TABLE agent_long_responses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own long responses"
  ON agent_long_responses FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own long responses"
  ON agent_long_responses FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "System can update long responses"
  ON agent_long_responses FOR UPDATE
  USING (true);

CREATE POLICY "Users can delete their own long responses"
  ON agent_long_responses FOR DELETE
  USING (auth.uid()::text = user_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE agent_long_responses;