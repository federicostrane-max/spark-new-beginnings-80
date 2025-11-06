-- Create inter_agent_logs table for tracking all inter-agent communications
CREATE TABLE IF NOT EXISTS public.inter_agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  requesting_agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  consulted_agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  consulted_conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  task_description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('initiated', 'processing', 'completed', 'failed')),
  initiated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on inter_agent_logs
ALTER TABLE public.inter_agent_logs ENABLE ROW LEVEL SECURITY;

-- Users can view logs for their conversations
CREATE POLICY "Users can view inter-agent logs for their conversations"
ON public.inter_agent_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM agent_conversations c
    WHERE c.id = inter_agent_logs.requesting_conversation_id
    AND c.user_id = auth.uid()::text
  )
);

-- System can insert and update logs
CREATE POLICY "System can manage inter-agent logs"
ON public.inter_agent_logs
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_inter_agent_logs_requesting_conv ON public.inter_agent_logs(requesting_conversation_id);
CREATE INDEX idx_inter_agent_logs_status ON public.inter_agent_logs(status);
CREATE INDEX idx_inter_agent_logs_initiated_at ON public.inter_agent_logs(initiated_at DESC);