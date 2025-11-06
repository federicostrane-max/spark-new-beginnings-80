-- FASE 1: Tabelle di Logging per Auto-Manutenzione

-- Tabella 1: Traccia ogni esecuzione del timer auto-manutenzione
CREATE TABLE maintenance_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_completed_at TIMESTAMPTZ,
  execution_status TEXT NOT NULL DEFAULT 'running',
  -- 'running', 'success', 'partial_failure', 'error'
  
  -- Contatori delle operazioni
  documents_fixed INT DEFAULT 0,
  documents_failed INT DEFAULT 0,
  chunks_cleaned INT DEFAULT 0,
  agents_synced INT DEFAULT 0,
  agents_sync_failed INT DEFAULT 0,
  
  -- Dettagli extra in JSON
  details JSONB,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_maintenance_exec_started ON maintenance_execution_logs(execution_started_at DESC);
CREATE INDEX idx_maintenance_exec_status ON maintenance_execution_logs(execution_status);

-- Tabella 2: Traccia ogni singola operazione di manutenzione
CREATE TABLE maintenance_operation_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_log_id UUID NOT NULL REFERENCES maintenance_execution_logs(id) ON DELETE CASCADE,
  
  operation_type TEXT NOT NULL,
  -- 'fix_stuck_document', 'cleanup_orphaned_chunk', 'sync_agent'
  
  target_id UUID NOT NULL, -- document_id o agent_id
  target_name TEXT NOT NULL, -- nome documento o nome agente
  
  status TEXT NOT NULL,
  -- 'success', 'failed', 'retry_needed'
  
  attempt_number INT DEFAULT 1,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_maintenance_op_exec ON maintenance_operation_details(execution_log_id);
CREATE INDEX idx_maintenance_op_target ON maintenance_operation_details(target_id, operation_type);
CREATE INDEX idx_maintenance_op_status ON maintenance_operation_details(status);

-- Abilitare RLS per le tabelle
ALTER TABLE maintenance_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_operation_details ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can read logs
CREATE POLICY "Authenticated users can read execution logs"
ON maintenance_execution_logs FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can read operation details"
ON maintenance_operation_details FOR SELECT
TO authenticated
USING (true);

-- Only service role can insert/update
CREATE POLICY "Service role can manage execution logs"
ON maintenance_execution_logs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage operation details"
ON maintenance_operation_details FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Abilita estensioni per cron job
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Crea cron job per auto-maintenance ogni 5 minuti
SELECT cron.schedule(
  'auto-maintenance-job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/auto-maintenance',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);