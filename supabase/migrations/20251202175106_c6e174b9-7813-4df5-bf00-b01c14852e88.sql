-- Add updated_at column with trigger for auto-update
ALTER TABLE pipeline_a_hybrid_chunks_raw 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Trigger function for auto-update
CREATE OR REPLACE FUNCTION update_pipeline_a_hybrid_chunks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS set_pipeline_a_hybrid_chunks_updated_at ON pipeline_a_hybrid_chunks_raw;
CREATE TRIGGER set_pipeline_a_hybrid_chunks_updated_at
BEFORE UPDATE ON pipeline_a_hybrid_chunks_raw
FOR EACH ROW EXECUTE FUNCTION update_pipeline_a_hybrid_chunks_updated_at();

-- Initialize updated_at for existing chunks
UPDATE pipeline_a_hybrid_chunks_raw 
SET updated_at = COALESCE(embedded_at, created_at)
WHERE updated_at IS NULL;

-- Add embedding_retry_count column
ALTER TABLE pipeline_a_hybrid_chunks_raw 
ADD COLUMN IF NOT EXISTS embedding_retry_count INTEGER DEFAULT 0;