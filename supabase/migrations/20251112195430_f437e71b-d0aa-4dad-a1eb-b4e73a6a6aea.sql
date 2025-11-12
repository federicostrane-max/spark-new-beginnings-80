-- FASE 1 & 2: Reset completo e nuovo schema database

-- 1. Eliminare tabelle vecchie
DROP TABLE IF EXISTS knowledge_relevance_scores CASCADE;
DROP TABLE IF EXISTS knowledge_gap_analysis CASCADE;
DROP TABLE IF EXISTS alignment_analysis_log CASCADE;
DROP TABLE IF EXISTS agent_task_requirements CASCADE;

-- 2. Nuova tabella Task Requirements (6 campi flat dal prompt v6)
CREATE TABLE agent_task_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  
  -- 6 CAMPI FLAT dal prompt v6
  theoretical_concepts TEXT[] NOT NULL DEFAULT '{}',
  operational_concepts TEXT[] NOT NULL DEFAULT '{}',
  procedural_knowledge TEXT[] NOT NULL DEFAULT '{}',
  explicit_rules TEXT[] NOT NULL DEFAULT '{}',
  domain_vocabulary TEXT[] NOT NULL DEFAULT '{}',
  bibliographic_references JSONB NOT NULL DEFAULT '[]',
  
  -- Metadata
  extraction_model TEXT NOT NULL,
  system_prompt_hash TEXT NOT NULL,
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(agent_id)
);

CREATE INDEX idx_task_requirements_agent ON agent_task_requirements(agent_id);
CREATE INDEX idx_task_requirements_hash ON agent_task_requirements(system_prompt_hash);

-- 3. Tabella Prerequisiti Check
CREATE TABLE prerequisite_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES agent_task_requirements(id) ON DELETE CASCADE,
  
  -- Risultati check bibliografico
  check_passed BOOLEAN NOT NULL,
  missing_critical_sources JSONB DEFAULT '[]',
  critical_sources_found JSONB DEFAULT '[]',
  
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prerequisite_checks_agent ON prerequisite_checks(agent_id);

-- 4. Tabella Knowledge Scores (5 dimensioni incluso bibliographic_match al 20%)
CREATE TABLE knowledge_relevance_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID REFERENCES agent_knowledge(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES agent_task_requirements(id) ON DELETE CASCADE,
  
  -- 5 DIMENSIONI DI SCORING
  semantic_relevance DECIMAL(4,3) NOT NULL,
  concept_coverage DECIMAL(4,3) NOT NULL,
  procedural_match DECIMAL(4,3) NOT NULL,
  vocabulary_alignment DECIMAL(4,3) NOT NULL,
  bibliographic_match DECIMAL(4,3) NOT NULL,
  
  -- Score finale pesato
  final_relevance_score DECIMAL(4,3) NOT NULL,
  
  -- Metadata
  analysis_model TEXT NOT NULL,
  analysis_reasoning TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(chunk_id, requirement_id)
);

CREATE INDEX idx_scores_chunk ON knowledge_relevance_scores(chunk_id);
CREATE INDEX idx_scores_agent ON knowledge_relevance_scores(agent_id);
CREATE INDEX idx_scores_final ON knowledge_relevance_scores(final_relevance_score);

-- 5. Tabella Alignment Analysis Log
CREATE TABLE alignment_analysis_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES agent_task_requirements(id),
  
  -- Risultati prerequisiti
  prerequisite_check_passed BOOLEAN NOT NULL,
  missing_critical_sources JSONB DEFAULT '[]',
  
  -- Risultati scoring (se prerequisiti passati)
  overall_alignment_percentage DECIMAL(5,2),
  dimension_breakdown JSONB,
  
  -- Statistiche
  total_chunks_analyzed INTEGER NOT NULL DEFAULT 0,
  chunks_flagged_for_removal INTEGER NOT NULL DEFAULT 0,
  chunks_auto_removed INTEGER NOT NULL DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alignment_log_agent ON alignment_analysis_log(agent_id);
CREATE INDEX idx_alignment_log_completed ON alignment_analysis_log(completed_at);

-- Enable RLS
ALTER TABLE agent_task_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE prerequisite_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_relevance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE alignment_analysis_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their agent task requirements"
  ON agent_task_requirements FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert task requirements"
  ON agent_task_requirements FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update task requirements"
  ON agent_task_requirements FOR UPDATE
  USING (true);

CREATE POLICY "Users can view their prerequisite checks"
  ON prerequisite_checks FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can manage prerequisite checks"
  ON prerequisite_checks FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view their knowledge scores"
  ON knowledge_relevance_scores FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can manage knowledge scores"
  ON knowledge_relevance_scores FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view their analysis logs"
  ON alignment_analysis_log FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can manage analysis logs"
  ON alignment_analysis_log FOR ALL
  USING (true)
  WITH CHECK (true);