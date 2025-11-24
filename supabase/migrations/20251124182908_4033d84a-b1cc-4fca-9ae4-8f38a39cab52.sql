-- Add chunk_id column to pipeline_b_chunks_raw for Landing AI chunk identification
ALTER TABLE pipeline_b_chunks_raw 
ADD COLUMN IF NOT EXISTS chunk_id TEXT;

-- Add index for faster lookups by chunk_id
CREATE INDEX IF NOT EXISTS idx_pipeline_b_chunks_chunk_id 
ON pipeline_b_chunks_raw(chunk_id);

COMMENT ON COLUMN pipeline_b_chunks_raw.chunk_id IS 'Unique chunk identifier from Landing AI API (REQUIRED field in API response)';