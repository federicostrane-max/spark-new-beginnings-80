-- Add workflow state columns to agent_conversations table
ALTER TABLE public.agent_conversations 
ADD COLUMN IF NOT EXISTS last_proposed_query TEXT,
ADD COLUMN IF NOT EXISTS waiting_for_confirmation BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS workflow_updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();