-- Create browser_tasks table for local Playwright bridge
CREATE TABLE public.browser_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  interface_expert_conversation_id UUID REFERENCES public.agent_conversations(id),
  agent_id UUID REFERENCES public.agents(id),
  task_type TEXT NOT NULL, -- es: "create_listing", "upload_photos", "scrape_data"
  platform TEXT NOT NULL, -- es: "airbnb", "booking", "lovable"
  instructions JSONB NOT NULL DEFAULT '{}'::jsonb, -- dettagli del task
  input_folders TEXT[] DEFAULT '{}', -- percorsi cartelle locali
  output_folder TEXT, -- dove salvare file scaricati
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result JSONB, -- esito del task
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for realtime polling by local app
CREATE INDEX idx_browser_tasks_status ON public.browser_tasks(status);
CREATE INDEX idx_browser_tasks_created_at ON public.browser_tasks(created_at DESC);

-- Enable RLS
ALTER TABLE public.browser_tasks ENABLE ROW LEVEL SECURITY;

-- Policies: Interface Expert (service role) can manage, users can view their tasks
CREATE POLICY "Service role full access on browser_tasks"
ON public.browser_tasks FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Users can view tasks from their conversations"
ON public.browser_tasks FOR SELECT
USING (
  interface_expert_conversation_id IN (
    SELECT id FROM agent_conversations WHERE user_id = auth.uid()::text
  )
);

-- Enable realtime for local app to listen
ALTER PUBLICATION supabase_realtime ADD TABLE public.browser_tasks;

-- Add comment for documentation
COMMENT ON TABLE public.browser_tasks IS 'Tasks for local Playwright bridge app. Local app listens via Supabase Realtime and executes browser automation.';