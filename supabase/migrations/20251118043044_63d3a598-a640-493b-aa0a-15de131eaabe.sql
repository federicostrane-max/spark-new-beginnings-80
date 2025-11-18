-- Create edge_function_execution_logs table for persistent logging
CREATE TABLE IF NOT EXISTS edge_function_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  execution_id UUID NOT NULL,
  log_level TEXT NOT NULL CHECK (log_level IN ('debug', 'info', 'warn', 'error')),
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_edge_logs_function_exec ON edge_function_execution_logs(function_name, execution_id);
CREATE INDEX IF NOT EXISTS idx_edge_logs_created ON edge_function_execution_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_logs_agent ON edge_function_execution_logs(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_edge_logs_level ON edge_function_execution_logs(log_level);

-- Fix alignment_analysis_log schema - add missing columns
ALTER TABLE alignment_analysis_log 
  ADD COLUMN IF NOT EXISTS chunks_removed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunks_kept INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS execution_id UUID,
  ADD COLUMN IF NOT EXISTS actual_chunks_scored INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS integrity_valid BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS integrity_message TEXT;

-- RLS policies for edge_function_execution_logs
ALTER TABLE edge_function_execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System can manage edge logs"
  ON edge_function_execution_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view edge logs"
  ON edge_function_execution_logs
  FOR SELECT
  USING (auth.uid() IS NOT NULL);