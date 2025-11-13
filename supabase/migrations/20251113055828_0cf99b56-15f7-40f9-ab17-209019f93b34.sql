-- Add analysis configuration tracking columns
-- These columns allow us to audit which weights and thresholds were used in each analysis

-- Add weights_used column to knowledge_relevance_scores
-- Stores the actual weights used for this specific scoring
ALTER TABLE knowledge_relevance_scores 
ADD COLUMN IF NOT EXISTS weights_used JSONB;

-- Add analysis_config column to alignment_analysis_log
-- Stores complete configuration (agent type, criticality, weights, thresholds)
ALTER TABLE alignment_analysis_log
ADD COLUMN IF NOT EXISTS analysis_config JSONB;

-- Add comment for documentation
COMMENT ON COLUMN knowledge_relevance_scores.weights_used IS 'JSON object containing the scoring weights used for this analysis (semantic_relevance, concept_coverage, procedural_match, vocabulary_alignment, bibliographic_match)';

COMMENT ON COLUMN alignment_analysis_log.analysis_config IS 'JSON object containing full analysis configuration including agent_type, domain_criticality, weights_used, and removal_threshold';