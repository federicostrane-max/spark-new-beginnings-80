-- ============================================================================
-- MIGRATION: Browser Tasks - Switch from task_secret to user_id authentication
-- ============================================================================

-- 1. FIRST: Drop old RLS policies based on task_secret (must be done BEFORE dropping column)
DROP POLICY IF EXISTS "Anon can select with valid task_secret" ON public.browser_tasks;
DROP POLICY IF EXISTS "Anon can update with valid task_secret" ON public.browser_tasks;
DROP POLICY IF EXISTS "Anon can select steps with valid task_secret" ON public.browser_steps;
DROP POLICY IF EXISTS "Anon can update steps with valid task_secret" ON public.browser_steps;
DROP POLICY IF EXISTS "Anon can insert steps with valid task_secret" ON public.browser_steps;

-- 2. Remove task_secret column and index (NOW safe after policies dropped)
DROP INDEX IF EXISTS idx_browser_tasks_task_secret;
ALTER TABLE public.browser_tasks DROP COLUMN IF EXISTS task_secret;

-- 3. Add user_id column for user-based authentication
ALTER TABLE public.browser_tasks 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- 4. Add structured action columns to browser_steps
ALTER TABLE public.browser_steps 
ADD COLUMN IF NOT EXISTS action_type TEXT,
ADD COLUMN IF NOT EXISTS action_target TEXT,
ADD COLUMN IF NOT EXISTS action_value TEXT;

-- 5. Create new RLS policies for browser_tasks based on user_id
CREATE POLICY "Users can view own tasks"
ON public.browser_tasks FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tasks"  
ON public.browser_tasks FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks"
ON public.browser_tasks FOR UPDATE
USING (auth.uid() = user_id);

-- 6. Create new RLS policies for browser_steps based on user_id of parent task
CREATE POLICY "Users can view own task steps"
ON public.browser_steps FOR SELECT
USING (EXISTS (SELECT 1 FROM public.browser_tasks t WHERE t.id = browser_steps.task_id AND t.user_id = auth.uid()));

CREATE POLICY "Users can insert own task steps"
ON public.browser_steps FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.browser_tasks t WHERE t.id = browser_steps.task_id AND t.user_id = auth.uid()));

CREATE POLICY "Users can update own task steps"
ON public.browser_steps FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.browser_tasks t WHERE t.id = browser_steps.task_id AND t.user_id = auth.uid()));

-- 7. Enable Realtime for both tables (ignore if already added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'browser_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE browser_tasks;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'browser_steps'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE browser_steps;
  END IF;
END $$;