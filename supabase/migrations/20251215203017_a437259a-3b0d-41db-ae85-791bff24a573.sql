-- ============================================
-- UNIFIED LUX AUTOMATION SCHEMA
-- Replaces browser_tasks + browser_steps
-- ============================================

-- 1. Create lux_tasks table (main task)
CREATE TABLE lux_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  agent_id UUID REFERENCES agents(id),
  conversation_id UUID,
  
  -- USER INPUT
  user_request TEXT NOT NULL,
  task_description TEXT NOT NULL,
  
  -- LUX CONFIGURATION
  lux_mode TEXT NOT NULL CHECK (lux_mode IN ('actor', 'thinker', 'tasker')),
  lux_model TEXT NOT NULL DEFAULT 'lux-actor-1',
  max_steps INTEGER DEFAULT 60,
  temperature FLOAT DEFAULT 0.1,
  
  -- METADATA
  platform TEXT,
  start_url TEXT,
  complexity TEXT CHECK (complexity IN ('simple', 'medium', 'complex')),
  software_detected TEXT,
  
  -- STATUS
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  progress INTEGER DEFAULT 0,
  
  -- RESULTS
  result TEXT,
  error_message TEXT,
  execution_summary JSONB,
  
  -- TIMESTAMPS
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- 2. Create lux_todos table (for Tasker mode)
CREATE TABLE lux_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES lux_tasks(id) ON DELETE CASCADE,
  
  -- TODO DETAILS
  todo_index INTEGER NOT NULL,
  todo_description TEXT NOT NULL,
  instruction TEXT,
  
  -- STRUCTURED ACTION DATA
  action_type TEXT,
  action_target TEXT,
  action_value TEXT,
  expected_outcome TEXT,
  
  -- STATUS
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result TEXT,
  error_message TEXT,
  
  -- RETRY LOGIC
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- LUX FEEDBACK
  screenshot_before TEXT,
  screenshot_after TEXT,
  lux_feedback JSONB,
  lux_actions JSONB,
  verification_status TEXT,
  verification_notes TEXT,
  
  -- TIMESTAMPS
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  UNIQUE(task_id, todo_index)
);

-- 3. Enable Row Level Security
ALTER TABLE lux_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lux_todos ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for lux_tasks
CREATE POLICY "Users can view own lux_tasks" ON lux_tasks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own lux_tasks" ON lux_tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lux_tasks" ON lux_tasks
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on lux_tasks" ON lux_tasks
  FOR ALL USING (true) WITH CHECK (true);

-- 5. RLS Policies for lux_todos
CREATE POLICY "Users can view own lux_todos" ON lux_todos
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM lux_tasks t WHERE t.id = lux_todos.task_id AND t.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own lux_todos" ON lux_todos
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM lux_tasks t WHERE t.id = lux_todos.task_id AND t.user_id = auth.uid()
  ));

CREATE POLICY "Users can update own lux_todos" ON lux_todos
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM lux_tasks t WHERE t.id = lux_todos.task_id AND t.user_id = auth.uid()
  ));

CREATE POLICY "Service role full access on lux_todos" ON lux_todos
  FOR ALL USING (true) WITH CHECK (true);

-- 6. Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE lux_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE lux_todos;

-- 7. Set REPLICA IDENTITY FULL for complete event payloads
ALTER TABLE lux_tasks REPLICA IDENTITY FULL;
ALTER TABLE lux_todos REPLICA IDENTITY FULL;

-- 8. Create indexes for performance
CREATE INDEX idx_lux_tasks_user_id ON lux_tasks(user_id);
CREATE INDEX idx_lux_tasks_status ON lux_tasks(status);
CREATE INDEX idx_lux_tasks_conversation_id ON lux_tasks(conversation_id);
CREATE INDEX idx_lux_todos_task_id ON lux_todos(task_id);
CREATE INDEX idx_lux_todos_status ON lux_todos(status);

-- 9. Create trigger for updating progress
CREATE OR REPLACE FUNCTION update_lux_task_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_total INTEGER;
  v_completed INTEGER;
  v_progress INTEGER;
BEGIN
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total, v_completed
  FROM lux_todos
  WHERE task_id = NEW.task_id;
  
  IF v_total > 0 THEN
    v_progress := (v_completed * 100) / v_total;
  ELSE
    v_progress := 0;
  END IF;
  
  UPDATE lux_tasks
  SET progress = v_progress
  WHERE id = NEW.task_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_lux_task_progress_trigger
AFTER UPDATE ON lux_todos
FOR EACH ROW
EXECUTE FUNCTION update_lux_task_progress();

-- 10. Drop old tables (CASCADE removes dependent triggers/policies)
DROP TABLE IF EXISTS browser_steps CASCADE;
DROP TABLE IF EXISTS browser_tasks CASCADE;