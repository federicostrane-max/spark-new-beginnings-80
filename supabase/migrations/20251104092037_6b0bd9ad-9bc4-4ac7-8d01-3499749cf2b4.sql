-- Add llm_provider column to agent_messages to track which LLM responded
ALTER TABLE public.agent_messages 
ADD COLUMN llm_provider TEXT;

-- Add comment
COMMENT ON COLUMN public.agent_messages.llm_provider IS 'LLM provider used for this message (anthropic, deepseek, openai)';