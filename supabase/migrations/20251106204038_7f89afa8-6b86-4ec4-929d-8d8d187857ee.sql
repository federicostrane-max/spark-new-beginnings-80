-- Add progress tracking to alignment_analysis_log
ALTER TABLE alignment_analysis_log
ADD COLUMN IF NOT EXISTS progress_chunks_analyzed INTEGER DEFAULT 0;

-- Add index to knowledge_relevance_scores for faster lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_relevance_scores_requirement_analyzed
ON knowledge_relevance_scores(requirement_id, analyzed_at DESC);

-- Add index for chunk_id lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_relevance_scores_chunk_requirement
ON knowledge_relevance_scores(chunk_id, requirement_id);