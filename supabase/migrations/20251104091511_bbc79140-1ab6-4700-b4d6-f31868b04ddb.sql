-- Add llm_provider column to agents table
ALTER TABLE public.agents 
ADD COLUMN llm_provider TEXT DEFAULT 'anthropic' CHECK (llm_provider IN ('anthropic', 'deepseek', 'openai'));

-- Add comment
COMMENT ON COLUMN public.agents.llm_provider IS 'LLM provider to use for this agent: anthropic, deepseek, or openai';