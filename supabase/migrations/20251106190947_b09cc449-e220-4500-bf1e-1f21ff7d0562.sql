-- FASE 1: Database Schema per Sistema Autonomo Allineamento Knowledge Base

-- 1.1 Modifiche a tabelle esistenti
ALTER TABLE agent_knowledge 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS removal_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_is_active ON agent_knowledge(is_active);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_active_chunks ON agent_knowledge(agent_id, is_active) WHERE is_active = true;

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS first_alignment_completed_at TIMESTAMPTZ;

-- 1.2 Nuova tabella: agent_task_requirements
CREATE TABLE IF NOT EXISTS agent_task_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  
  -- Core extracted requirements from system_prompt
  core_concepts JSONB NOT NULL DEFAULT '[]',
  procedural_knowledge JSONB NOT NULL DEFAULT '[]',
  decision_patterns JSONB NOT NULL DEFAULT '[]',
  domain_vocabulary JSONB NOT NULL DEFAULT '[]',
  
  -- Metadata
  extraction_model TEXT NOT NULL DEFAULT 'openai/gpt-5-mini',
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  system_prompt_hash TEXT NOT NULL,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(agent_id)
);

-- 1.3 Nuova tabella: knowledge_relevance_scores
CREATE TABLE IF NOT EXISTS knowledge_relevance_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  chunk_id UUID NOT NULL REFERENCES agent_knowledge(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES agent_task_requirements(id) ON DELETE CASCADE,
  
  -- Relevance scores
  semantic_relevance DECIMAL(3,2) NOT NULL CHECK (semantic_relevance >= 0 AND semantic_relevance <= 1),
  concept_coverage DECIMAL(3,2) NOT NULL CHECK (concept_coverage >= 0 AND concept_coverage <= 1),
  procedural_match DECIMAL(3,2) NOT NULL CHECK (procedural_match >= 0 AND procedural_match <= 1),
  vocabulary_alignment DECIMAL(3,2) NOT NULL CHECK (vocabulary_alignment >= 0 AND vocabulary_alignment <= 1),
  
  -- Final weighted score
  final_relevance_score DECIMAL(3,2) NOT NULL CHECK (final_relevance_score >= 0 AND final_relevance_score <= 1),
  
  -- Analysis details
  analysis_model TEXT NOT NULL DEFAULT 'openai/gpt-5-mini',
  analysis_reasoning TEXT,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(chunk_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_relevance_scores_chunk ON knowledge_relevance_scores(chunk_id);
CREATE INDEX IF NOT EXISTS idx_relevance_scores_agent ON knowledge_relevance_scores(agent_id);
CREATE INDEX IF NOT EXISTS idx_relevance_scores_final_score ON knowledge_relevance_scores(final_relevance_score);

-- 1.4 Nuova tabella: knowledge_removal_history
CREATE TABLE IF NOT EXISTS knowledge_removal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Original chunk data (backup completo)
  chunk_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT,
  embedding vector(1536),
  pool_document_id UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  source_type TEXT,
  
  -- Removal metadata
  removed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removal_reason TEXT NOT NULL,
  final_relevance_score DECIMAL(3,2),
  
  -- Was it auto-removed or manual?
  removal_type TEXT NOT NULL CHECK (removal_type IN ('auto', 'manual')),
  
  -- Rollback tracking
  restored_at TIMESTAMPTZ,
  restoration_user_id TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_removal_history_agent ON knowledge_removal_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_removal_history_removed_at ON knowledge_removal_history(removed_at);
CREATE INDEX IF NOT EXISTS idx_removal_history_restored ON knowledge_removal_history(restored_at) WHERE restored_at IS NULL;

-- 1.5 Nuova tabella: alignment_analysis_log
CREATE TABLE IF NOT EXISTS alignment_analysis_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  
  -- Analysis trigger
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'prompt_change', 'scheduled', 'document_added')),
  
  -- Results summary
  total_chunks_analyzed INTEGER NOT NULL,
  chunks_flagged_for_removal INTEGER NOT NULL,
  chunks_auto_removed INTEGER NOT NULL DEFAULT 0,
  
  -- Coverage metrics
  concept_coverage_percentage DECIMAL(5,2),
  identified_gaps JSONB DEFAULT '[]',
  surplus_categories JSONB DEFAULT '[]',
  
  -- Safe mode tracking
  safe_mode_active BOOLEAN NOT NULL DEFAULT false,
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Errors
  error_message TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_log_agent ON alignment_analysis_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_analysis_log_started ON alignment_analysis_log(started_at);

-- Enable RLS on new tables
ALTER TABLE agent_task_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_relevance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_removal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE alignment_analysis_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow authenticated users to access their own data
CREATE POLICY "Users can view their agent task requirements"
  ON agent_task_requirements FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view their knowledge relevance scores"
  ON knowledge_relevance_scores FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view their removal history"
  ON knowledge_removal_history FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view their analysis logs"
  ON alignment_analysis_log FOR SELECT
  USING (auth.uid() IS NOT NULL);