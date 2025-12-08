-- Drop existing browser_tasks table to recreate with new schema
DROP TABLE IF EXISTS public.browser_tasks CASCADE;

-- Create browser_tasks table
CREATE TABLE public.browser_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  task_type TEXT NOT NULL,
  task_description TEXT NOT NULL,
  task_data JSONB,
  input_folders TEXT[],
  output_folder TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  total_steps INTEGER DEFAULT 0,
  completed_steps INTEGER DEFAULT 0,
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create browser_steps table
CREATE TABLE public.browser_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.browser_tasks(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  instruction TEXT NOT NULL,
  instruction_context TEXT,
  expected_outcome TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  screenshot_before TEXT,
  screenshot_after TEXT,
  lux_feedback JSONB,
  lux_actions JSONB,
  verification_status TEXT CHECK (verification_status IN ('pending', 'verified', 'failed', 'needs_retry')),
  verification_notes TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for browser_tasks
CREATE INDEX idx_browser_tasks_status ON public.browser_tasks(status);
CREATE INDEX idx_browser_tasks_created_at ON public.browser_tasks(created_at DESC);

-- Indexes for browser_steps
CREATE INDEX idx_browser_steps_task_id ON public.browser_steps(task_id);
CREATE INDEX idx_browser_steps_status ON public.browser_steps(status);
CREATE INDEX idx_browser_steps_task_step ON public.browser_steps(task_id, step_number);

-- Enable RLS on both tables
ALTER TABLE public.browser_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.browser_steps ENABLE ROW LEVEL SECURITY;

-- RLS Policies for browser_tasks
CREATE POLICY "Authenticated users can select browser_tasks"
ON public.browser_tasks FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert browser_tasks"
ON public.browser_tasks FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update browser_tasks"
ON public.browser_tasks FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Service role full access on browser_tasks"
ON public.browser_tasks FOR ALL
USING (true)
WITH CHECK (true);

-- RLS Policies for browser_steps
CREATE POLICY "Authenticated users can select browser_steps"
ON public.browser_steps FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert browser_steps"
ON public.browser_steps FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update browser_steps"
ON public.browser_steps FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Service role full access on browser_steps"
ON public.browser_steps FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger function to update task progress when step completes
CREATE OR REPLACE FUNCTION public.update_task_progress_on_step_change()
RETURNS TRIGGER AS $$
DECLARE
  v_total_steps INTEGER;
  v_completed_steps INTEGER;
  v_progress INTEGER;
BEGIN
  -- Count total and completed steps for this task
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total_steps, v_completed_steps
  FROM public.browser_steps
  WHERE task_id = NEW.task_id;
  
  -- Calculate progress percentage
  IF v_total_steps > 0 THEN
    v_progress := (v_completed_steps * 100) / v_total_steps;
  ELSE
    v_progress := 0;
  END IF;
  
  -- Update parent task
  UPDATE public.browser_tasks
  SET 
    total_steps = v_total_steps,
    completed_steps = v_completed_steps,
    progress = v_progress,
    updated_at = now(),
    -- Auto-complete task if all steps are done
    status = CASE 
      WHEN v_completed_steps = v_total_steps AND v_total_steps > 0 THEN 'completed'
      ELSE status
    END,
    completed_at = CASE 
      WHEN v_completed_steps = v_total_steps AND v_total_steps > 0 THEN now()
      ELSE completed_at
    END
  WHERE id = NEW.task_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on browser_steps
CREATE TRIGGER trigger_update_task_progress
AFTER INSERT OR UPDATE OF status ON public.browser_steps
FOR EACH ROW
EXECUTE FUNCTION public.update_task_progress_on_step_change();

-- Trigger function to update updated_at on browser_tasks
CREATE OR REPLACE FUNCTION public.update_browser_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_browser_tasks_updated_at
BEFORE UPDATE ON public.browser_tasks
FOR EACH ROW
EXECUTE FUNCTION public.update_browser_tasks_updated_at();

-- Enable Realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.browser_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.browser_steps;

-- Comments for documentation
COMMENT ON TABLE public.browser_tasks IS 'Browser automation tasks for local Lux/Playwright bridge. Each task represents a complete automation job.';
COMMENT ON TABLE public.browser_steps IS 'Individual steps within a browser automation task. Each step is an instruction for Lux to execute.';