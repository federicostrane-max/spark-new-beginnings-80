-- Create table for agent prompt history
CREATE TABLE public.agent_prompt_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  system_prompt TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  version_number INTEGER NOT NULL DEFAULT 1
);

-- Enable Row Level Security
ALTER TABLE public.agent_prompt_history ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view prompt history for their agents"
ON public.agent_prompt_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM agents
    WHERE agents.id = agent_prompt_history.agent_id
    AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  )
);

CREATE POLICY "Users can insert prompt history for their agents"
ON public.agent_prompt_history
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM agents
    WHERE agents.id = agent_prompt_history.agent_id
    AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  )
);

-- Create index for better performance
CREATE INDEX idx_agent_prompt_history_agent_id ON public.agent_prompt_history(agent_id);
CREATE INDEX idx_agent_prompt_history_created_at ON public.agent_prompt_history(created_at DESC);