-- Fix embedding_status check constraint to include 'waiting_enrichment'
ALTER TABLE pipeline_a_hybrid_chunks_raw 
DROP CONSTRAINT IF EXISTS pipeline_a_hybrid_chunks_raw_embedding_status_check;

ALTER TABLE pipeline_a_hybrid_chunks_raw 
ADD CONSTRAINT pipeline_a_hybrid_chunks_raw_embedding_status_check 
CHECK (embedding_status IN ('pending', 'processing', 'ready', 'failed', 'waiting_enrichment'));