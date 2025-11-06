-- Fix search_path per le funzioni create nella migration precedente

-- Fix log_operation_start
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
SET search_path TO 'public'
AS $$
DECLARE
  v_agent_name TEXT;
  v_log_id UUID;
BEGIN
  SELECT name INTO v_agent_name
  FROM agents
  WHERE id = p_agent_id;
  
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

-- Fix log_operation_complete
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
SET search_path TO 'public'
AS $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_duration_ms INTEGER;
BEGIN
  SELECT started_at INTO v_started_at
  FROM agent_operation_logs
  WHERE id = p_log_id;
  
  v_duration_ms := EXTRACT(EPOCH FROM (now() - v_started_at)) * 1000;
  
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

-- Fix create_alert_on_failed_operation
CREATE OR REPLACE FUNCTION create_alert_on_failed_operation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_title TEXT;
  v_message TEXT;
  v_alert_type TEXT;
BEGIN
  IF NEW.status NOT IN ('failed', 'timeout') THEN
    RETURN NEW;
  END IF;
  
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