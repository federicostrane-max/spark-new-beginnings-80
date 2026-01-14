-- ============================================================
-- TABELLE PER PROCEDURE-BASED AUTOMATION
-- ============================================================

-- Tabella per procedure apprese
CREATE TABLE IF NOT EXISTS saved_procedures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  learned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  url_pattern TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_success TIMESTAMPTZ,
  last_fail TIMESTAMPTZ,
  steps JSONB NOT NULL DEFAULT '[]',
  goal TEXT NOT NULL,
  success_criteria TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabella per log esecuzioni
CREATE TABLE IF NOT EXISTS execution_logs (
  execution_id TEXT PRIMARY KEY,
  task_description TEXT NOT NULL,
  procedure_id TEXT REFERENCES saved_procedures(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('learning', 'execution')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial')) DEFAULT 'running',
  steps JSONB NOT NULL DEFAULT '[]',
  stats JSONB NOT NULL DEFAULT '{}',
  environment JSONB NOT NULL DEFAULT '{}',
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE saved_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies per saved_procedures
CREATE POLICY "Users can view own procedures" ON saved_procedures FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own procedures" ON saved_procedures FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can update own procedures" ON saved_procedures FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own procedures" ON saved_procedures FOR DELETE USING (auth.uid() = user_id);

-- RLS policies per execution_logs
CREATE POLICY "Users can view own logs" ON execution_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own logs" ON execution_logs FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can update own logs" ON execution_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own logs" ON execution_logs FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- INDICI PER PERFORMANCE
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_saved_procedures_user_id ON saved_procedures(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_procedures_url_pattern ON saved_procedures(url_pattern);
CREATE INDEX IF NOT EXISTS idx_execution_logs_user_id ON execution_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_procedure_id ON execution_logs(procedure_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_status ON execution_logs(status);

-- ============================================================
-- VIEW ANALYTICS
-- ============================================================

-- View per report discrepanze DOM/Vision
CREATE OR REPLACE VIEW discrepancy_report AS
SELECT 
  el.execution_id,
  el.task_description,
  el.started_at,
  el.status,
  step_data->>'step_index' as step_index,
  step_data->>'action' as action,
  step_data->>'target' as target,
  step_data->'verification'->>'pattern' as verification_pattern,
  step_data->'verification'->'dom'->>'found' as dom_found,
  step_data->'verification'->'lux'->>'found' as lux_found,
  step_data->'verification'->'gemini'->>'found' as gemini_found,
  step_data->'verification'->>'distance_dom_lux' as distance_dom_lux,
  step_data->'verification'->>'distance_dom_gemini' as distance_dom_gemini,
  step_data->'verification'->>'distance_lux_gemini' as distance_lux_gemini,
  step_data->'verification'->>'decision' as decision,
  step_data->'verification'->>'confidence' as confidence
FROM execution_logs el,
LATERAL jsonb_array_elements(el.steps) AS step_data
WHERE step_data->'verification' IS NOT NULL
ORDER BY el.started_at DESC, (step_data->>'step_index')::int;

-- View per statistiche procedure
CREATE OR REPLACE VIEW procedure_stats AS
SELECT 
  sp.id,
  sp.name,
  sp.url_pattern,
  sp.goal,
  sp.success_count,
  sp.fail_count,
  CASE 
    WHEN (sp.success_count + sp.fail_count) > 0 
    THEN ROUND((sp.success_count::numeric / (sp.success_count + sp.fail_count)) * 100, 2)
    ELSE 0 
  END as success_rate,
  sp.last_success,
  sp.last_fail,
  jsonb_array_length(sp.steps) as total_steps,
  sp.learned_at,
  sp.user_id,
  (
    SELECT COUNT(*) 
    FROM execution_logs el 
    WHERE el.procedure_id = sp.id
  ) as total_executions
FROM saved_procedures sp
ORDER BY sp.success_count DESC, sp.learned_at DESC;

-- ============================================================
-- REALTIME PER MONITORING LIVE
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE execution_logs;