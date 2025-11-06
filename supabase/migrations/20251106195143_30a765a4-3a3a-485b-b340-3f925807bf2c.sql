-- ============================================================
-- PARTE 1: Tabella agent_operation_logs
-- ============================================================

CREATE TABLE agent_operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identificazione operazione
  operation_type TEXT NOT NULL,
  
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  
  -- Tracking temporale
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Stato operazione
  status TEXT NOT NULL DEFAULT 'running',
  
  -- Input/Output strutturati
  input_data JSONB,
  output_data JSONB,
  
  -- Error handling
  error_message TEXT,
  error_stack TEXT,
  error_code TEXT,
  
  -- Metadata per correlazione
  triggered_by TEXT,
  user_id UUID,
  correlation_id UUID,
  
  -- Metriche specifiche per operazione
  metrics JSONB,
  
  -- Validazioni post-operazione
  validation_status TEXT,
  validation_details JSONB,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indici per performance
CREATE INDEX idx_agent_operation_logs_agent_id ON agent_operation_logs(agent_id);
CREATE INDEX idx_agent_operation_logs_operation_type ON agent_operation_logs(operation_type);
CREATE INDEX idx_agent_operation_logs_status ON agent_operation_logs(status);
CREATE INDEX idx_agent_operation_logs_started_at ON agent_operation_logs(started_at DESC);
CREATE INDEX idx_agent_operation_logs_correlation ON agent_operation_logs(correlation_id);

-- RLS Policies
ALTER TABLE agent_operation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view logs for their agents"
  ON agent_operation_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_operation_logs.agent_id
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
    )
  );

CREATE POLICY "System can insert logs"
  ON agent_operation_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update logs"
  ON agent_operation_logs FOR UPDATE
  USING (true);

-- ============================================================
-- PARTE 2: Tabella agent_alerts
-- ============================================================

CREATE TABLE agent_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Collegamento ad operazione
  operation_log_id UUID REFERENCES agent_operation_logs(id) ON DELETE CASCADE,
  
  -- Targeting
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID,
  
  -- Tipo e severità
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  
  -- Contenuto
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  
  -- Action hints per UI
  action_type TEXT,
  action_url TEXT,
  
  -- Stato alert
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  dismissed BOOLEAN DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- Indici
CREATE INDEX idx_agent_alerts_user_id ON agent_alerts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_agent_alerts_agent_id ON agent_alerts(agent_id);
CREATE INDEX idx_agent_alerts_is_read ON agent_alerts(is_read) WHERE is_read = false;
CREATE INDEX idx_agent_alerts_severity ON agent_alerts(severity);
CREATE INDEX idx_agent_alerts_created_at ON agent_alerts(created_at DESC);

-- RLS Policies
ALTER TABLE agent_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their alerts"
  ON agent_alerts FOR SELECT
  USING (
    user_id = auth.uid() 
    OR user_id IS NULL
    OR EXISTS (
      SELECT 1 FROM agents
      WHERE agents.id = agent_alerts.agent_id
      AND agents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their alerts"
  ON agent_alerts FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "System can manage alerts"
  ON agent_alerts FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- PARTE 3: Helper Function - log_operation_start
-- ============================================================

CREATE OR REPLACE FUNCTION log_operation_start(
  p_operation_type TEXT,
  p_agent_id UUID,
  p_input_data JSONB DEFAULT NULL,
  p_triggered_by TEXT DEFAULT 'system',
  p_user_id UUID DEFAULT NULL,
  p_correlation_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_agent_name TEXT;
  v_log_id UUID;
BEGIN
  -- Get agent name
  SELECT name INTO v_agent_name
  FROM agents
  WHERE id = p_agent_id;
  
  -- Insert log entry
  INSERT INTO agent_operation_logs (
    operation_type,
    agent_id,
    agent_name,
    status,
    input_data,
    triggered_by,
    user_id,
    correlation_id
  ) VALUES (
    p_operation_type,
    p_agent_id,
    v_agent_name,
    'running',
    p_input_data,
    p_triggered_by,
    p_user_id,
    COALESCE(p_correlation_id, gen_random_uuid())
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

-- ============================================================
-- PARTE 4: Helper Function - log_operation_complete
-- ============================================================

CREATE OR REPLACE FUNCTION log_operation_complete(
  p_log_id UUID,
  p_status TEXT,
  p_output_data JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_error_stack TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_metrics JSONB DEFAULT NULL,
  p_validation_status TEXT DEFAULT NULL,
  p_validation_details JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_duration_ms INTEGER;
BEGIN
  -- Get started_at
  SELECT started_at INTO v_started_at
  FROM agent_operation_logs
  WHERE id = p_log_id;
  
  -- Calculate duration
  v_duration_ms := EXTRACT(EPOCH FROM (now() - v_started_at)) * 1000;
  
  -- Update log entry
  UPDATE agent_operation_logs
  SET
    completed_at = now(),
    duration_ms = v_duration_ms,
    status = p_status,
    output_data = p_output_data,
    error_message = p_error_message,
    error_stack = p_error_stack,
    error_code = p_error_code,
    metrics = p_metrics,
    validation_status = p_validation_status,
    validation_details = p_validation_details
  WHERE id = p_log_id;
END;
$$;

-- ============================================================
-- PARTE 5: Trigger - Auto-Create Alert on Failed Operation
-- ============================================================

CREATE OR REPLACE FUNCTION create_alert_on_failed_operation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
  v_alert_type TEXT;
BEGIN
  -- Solo se operazione fallita/timeout
  IF NEW.status NOT IN ('failed', 'timeout') THEN
    RETURN NEW;
  END IF;
  
  -- Determine alert details based on operation type
  CASE NEW.operation_type
    WHEN 'regenerate_prompt' THEN
      v_title := 'Rigenerazione Prompt Fallita';
      v_message := format('La rigenerazione del prompt per "%s" è fallita: %s', 
                         NEW.agent_name, COALESCE(NEW.error_message, 'Errore sconosciuto'));
      v_alert_type := 'operation_failed';
    
    WHEN 'extract_requirements' THEN
      v_title := 'Estrazione Requirements Fallita';
      v_message := format('L''estrazione dei requirements per "%s" è fallita: %s', 
                         NEW.agent_name, COALESCE(NEW.error_message, 'Errore sconosciuto'));
      v_alert_type := 'operation_failed';
    
    WHEN 'update_prompt' THEN
      v_title := 'Aggiornamento Prompt Fallito';
      v_message := format('L''aggiornamento del prompt per "%s" è fallito: %s', 
                         NEW.agent_name, COALESCE(NEW.error_message, 'Errore sconosciuto'));
      v_alert_type := 'prompt_not_updated';
    
    ELSE
      v_title := 'Operazione Fallita';
      v_message := format('Operazione "%s" per "%s" fallita', NEW.operation_type, NEW.agent_name);
      v_alert_type := 'operation_failed';
  END CASE;
  
  -- Insert alert
  INSERT INTO agent_alerts (
    operation_log_id,
    agent_id,
    user_id,
    alert_type,
    severity,
    title,
    message,
    details,
    action_type,
    action_url,
    expires_at
  ) VALUES (
    NEW.id,
    NEW.agent_id,
    NEW.user_id,
    v_alert_type,
    CASE WHEN NEW.status = 'timeout' THEN 'warning' ELSE 'error' END,
    v_title,
    v_message,
    jsonb_build_object(
      'operation_type', NEW.operation_type,
      'error_code', NEW.error_code,
      'duration_ms', NEW.duration_ms
    ),
    'view_logs',
    format('/admin?tab=operations&log_id=%s', NEW.id),
    now() + INTERVAL '7 days'
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_create_alert_on_failed_operation
  AFTER UPDATE ON agent_operation_logs
  FOR EACH ROW
  WHEN (OLD.status = 'running' AND NEW.status IN ('failed', 'timeout'))
  EXECUTE FUNCTION create_alert_on_failed_operation();