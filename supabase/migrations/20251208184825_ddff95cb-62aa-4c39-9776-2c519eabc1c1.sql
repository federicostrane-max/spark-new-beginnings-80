-- 1. Aggiungere colonna task_secret a browser_tasks
ALTER TABLE public.browser_tasks 
ADD COLUMN task_secret UUID NOT NULL DEFAULT gen_random_uuid();

-- 2. Creare indice per performance
CREATE INDEX idx_browser_tasks_task_secret ON public.browser_tasks(task_secret);

-- 3. RLS Policies per browser_tasks (anon con task_secret)

-- Permetti SELECT anonimo SOLO con task_secret valido (passato via header)
CREATE POLICY "Anon can select with valid task_secret"
ON public.browser_tasks FOR SELECT TO anon
USING (
  task_secret::text = COALESCE(
    current_setting('request.headers', true)::json->>'x-task-secret',
    ''
  )
);

-- Permetti UPDATE anonimo SOLO con task_secret valido
CREATE POLICY "Anon can update with valid task_secret"
ON public.browser_tasks FOR UPDATE TO anon
USING (
  task_secret::text = COALESCE(
    current_setting('request.headers', true)::json->>'x-task-secret',
    ''
  )
);

-- 4. RLS Policies per browser_steps (anon con task_secret del task padre)

-- Permetti SELECT anonimo SOLO se il task padre ha il secret corretto
CREATE POLICY "Anon can select steps with valid task_secret"
ON public.browser_steps FOR SELECT TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.browser_tasks t
    WHERE t.id = browser_steps.task_id
    AND t.task_secret::text = COALESCE(
      current_setting('request.headers', true)::json->>'x-task-secret',
      ''
    )
  )
);

-- Permetti UPDATE anonimo SOLO se il task padre ha il secret corretto
CREATE POLICY "Anon can update steps with valid task_secret"
ON public.browser_steps FOR UPDATE TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.browser_tasks t
    WHERE t.id = browser_steps.task_id
    AND t.task_secret::text = COALESCE(
      current_setting('request.headers', true)::json->>'x-task-secret',
      ''
    )
  )
);

-- Permetti INSERT anonimo SOLO se il task padre ha il secret corretto
CREATE POLICY "Anon can insert steps with valid task_secret"
ON public.browser_steps FOR INSERT TO anon
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.browser_tasks t
    WHERE t.id = browser_steps.task_id
    AND t.task_secret::text = COALESCE(
      current_setting('request.headers', true)::json->>'x-task-secret',
      ''
    )
  )
);