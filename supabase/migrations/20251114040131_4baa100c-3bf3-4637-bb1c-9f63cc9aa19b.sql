-- Create table for tracking analysis progress
CREATE TABLE IF NOT EXISTS alignment_analysis_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES agent_task_requirements(id) ON DELETE CASCADE,
  total_chunks INT NOT NULL,
  chunks_processed INT DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  current_batch INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  error_message TEXT,
  partial_results JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE alignment_analysis_progress ENABLE ROW LEVEL SECURITY;

-- Users can view their analysis progress
CREATE POLICY "Users can view their analysis progress"
  ON alignment_analysis_progress
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- System can manage analysis progress
CREATE POLICY "System can manage analysis progress"
  ON alignment_analysis_progress
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_alignment_progress_agent_status 
  ON alignment_analysis_progress(agent_id, status);

-- Add realtime
ALTER PUBLICATION supabase_realtime ADD TABLE alignment_analysis_progress;