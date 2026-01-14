-- ============================================================
-- Migration: Saved Procedures and Execution Logs
-- ============================================================
-- Tables for procedure-based automation with learning mode
-- ============================================================

-- ============================================================
-- TABLE: saved_procedures
-- ============================================================
-- Stores learned automation procedures for replay

CREATE TABLE IF NOT EXISTS saved_procedures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,

  -- When/where learned
  learned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  url_pattern TEXT NOT NULL,

  -- Usage stats
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_success TIMESTAMPTZ,
  last_fail TIMESTAMPTZ,

  -- The steps (JSONB array of ProcedureStep)
  steps JSONB NOT NULL DEFAULT '[]',

  -- Original goal
  goal TEXT NOT NULL,
  success_criteria TEXT,

  -- User/project association
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  project_id TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for saved_procedures
CREATE INDEX IF NOT EXISTS idx_saved_procedures_user_id ON saved_procedures(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_procedures_url_pattern ON saved_procedures(url_pattern);
CREATE INDEX IF NOT EXISTS idx_saved_procedures_name ON saved_procedures(name);
CREATE INDEX IF NOT EXISTS idx_saved_procedures_learned_at ON saved_procedures(learned_at DESC);

-- Enable RLS
ALTER TABLE saved_procedures ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own procedures" ON saved_procedures
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own procedures" ON saved_procedures
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update own procedures" ON saved_procedures
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own procedures" ON saved_procedures
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: execution_logs
-- ============================================================
-- Stores execution logs for analysis and debugging

CREATE TABLE IF NOT EXISTS execution_logs (
  execution_id TEXT PRIMARY KEY,
  task_description TEXT NOT NULL,
  procedure_id TEXT REFERENCES saved_procedures(id) ON DELETE SET NULL,

  -- Execution context
  mode TEXT NOT NULL CHECK (mode IN ('learning', 'execution')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial')) DEFAULT 'running',

  -- Step-by-step log (JSONB array of StepLog)
  steps JSONB NOT NULL DEFAULT '[]',

  -- Aggregated stats (JSONB of ExecutionStats)
  stats JSONB NOT NULL DEFAULT '{}',

  -- Environment info
  environment JSONB NOT NULL DEFAULT '{}',

  -- User association
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for execution_logs
CREATE INDEX IF NOT EXISTS idx_execution_logs_user_id ON execution_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_procedure_id ON execution_logs(procedure_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_started_at ON execution_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_logs_status ON execution_logs(status);
CREATE INDEX IF NOT EXISTS idx_execution_logs_mode ON execution_logs(mode);

-- Enable RLS
ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own logs" ON execution_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own logs" ON execution_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update own logs" ON execution_logs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own logs" ON execution_logs
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- VIEW: discrepancy_report
-- ============================================================
-- View to analyze DOM vs Vision discrepancies

CREATE OR REPLACE VIEW discrepancy_report AS
SELECT
  execution_id,
  task_description,
  mode,
  started_at,
  step_data->>'step_number' AS step_number,
  step_data->>'action_type' AS action_type,
  step_data->>'target_description' AS target_description,
  step_data->'verification'->>'pattern' AS pattern,
  step_data->'verification'->'distances'->>'dom_lux' AS dom_lux_distance,
  step_data->'verification'->'distances'->>'dom_gemini' AS dom_gemini_distance,
  step_data->'verification'->'distances'->>'lux_gemini' AS lux_gemini_distance,
  step_data->'verification'->'sources'->'dom'->>'x' AS dom_x,
  step_data->'verification'->'sources'->'dom'->>'y' AS dom_y,
  step_data->'verification'->'sources'->'lux'->>'x' AS lux_x,
  step_data->'verification'->'sources'->'lux'->>'y' AS lux_y,
  step_data->'verification'->'sources'->'gemini'->>'x' AS gemini_x,
  step_data->'verification'->'sources'->'gemini'->>'y' AS gemini_y,
  step_data->'execution'->>'success' AS step_success
FROM
  execution_logs,
  jsonb_array_elements(steps) AS step_data
WHERE
  step_data->'verification'->>'pattern' LIKE '%dom_far%'
  OR step_data->'verification'->>'pattern' = 'vision_disagree';

-- ============================================================
-- VIEW: procedure_stats
-- ============================================================
-- View to see procedure success rates

CREATE OR REPLACE VIEW procedure_stats AS
SELECT
  sp.id,
  sp.name,
  sp.url_pattern,
  sp.success_count,
  sp.fail_count,
  CASE
    WHEN (sp.success_count + sp.fail_count) > 0
    THEN ROUND(sp.success_count::NUMERIC / (sp.success_count + sp.fail_count) * 100, 1)
    ELSE 0
  END AS success_rate,
  sp.last_success,
  sp.last_fail,
  jsonb_array_length(sp.steps) AS step_count,
  sp.learned_at,
  sp.user_id
FROM saved_procedures sp
ORDER BY sp.success_count DESC;

-- ============================================================
-- FUNCTION: update_procedure_stats
-- ============================================================
-- Function to update procedure stats after execution

CREATE OR REPLACE FUNCTION update_procedure_stats(
  p_procedure_id TEXT,
  p_success BOOLEAN
) RETURNS void AS $$
BEGIN
  IF p_success THEN
    UPDATE saved_procedures
    SET
      success_count = success_count + 1,
      last_success = NOW(),
      updated_at = NOW()
    WHERE id = p_procedure_id;
  ELSE
    UPDATE saved_procedures
    SET
      fail_count = fail_count + 1,
      last_fail = NOW(),
      updated_at = NOW()
    WHERE id = p_procedure_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGER: auto_update_timestamp
-- ============================================================

CREATE OR REPLACE FUNCTION update_saved_procedures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER saved_procedures_updated_at
  BEFORE UPDATE ON saved_procedures
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_procedures_updated_at();
