-- Create knowledge_gap_analysis table for storing detailed gap analysis results
CREATE TABLE knowledge_gap_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES agent_task_requirements(id) ON DELETE CASCADE,
  analysis_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  missing_core_concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_procedural_knowledge JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_decision_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_domain_vocabulary JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  overall_gap_score NUMERIC NOT NULL CHECK (overall_gap_score >= 0 AND overall_gap_score <= 1),
  recommendations JSONB DEFAULT NULL,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE knowledge_gap_analysis ENABLE ROW LEVEL SECURITY;

-- Users can view gap analysis for their agents
CREATE POLICY "Users can view gap analysis for their agents"
ON knowledge_gap_analysis
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM agents
    WHERE agents.id = knowledge_gap_analysis.agent_id
    AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  )
);

-- System can insert gap analysis
CREATE POLICY "System can insert gap analysis"
ON knowledge_gap_analysis
FOR INSERT
WITH CHECK (true);

-- System can update gap analysis
CREATE POLICY "System can update gap analysis"
ON knowledge_gap_analysis
FOR UPDATE
USING (true);

-- Create index for faster queries
CREATE INDEX idx_gap_analysis_agent_date ON knowledge_gap_analysis(agent_id, analysis_date DESC);