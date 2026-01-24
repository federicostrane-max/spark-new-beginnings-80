-- Add AI-generated metadata columns to pipeline_a_hybrid_documents
ALTER TABLE pipeline_a_hybrid_documents
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS keywords TEXT[],
  ADD COLUMN IF NOT EXISTS topics TEXT[],
  ADD COLUMN IF NOT EXISTS complexity_level TEXT;

-- Add index for efficient filtering by complexity level
CREATE INDEX IF NOT EXISTS idx_pipeline_a_hybrid_documents_complexity
  ON pipeline_a_hybrid_documents(complexity_level);