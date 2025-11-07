-- Add progress tracking column to alignment_analysis_log
ALTER TABLE alignment_analysis_log 
ADD COLUMN IF NOT EXISTS progress_chunks_analyzed INTEGER DEFAULT 0;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_alignment_analysis_log_agent_started 
ON alignment_analysis_log(agent_id, started_at DESC);