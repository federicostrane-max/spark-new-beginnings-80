-- Add ai_model column to agents table to store specific model selection
ALTER TABLE public.agents 
ADD COLUMN IF NOT EXISTS ai_model TEXT;

-- Update the llm_provider check constraint to include openrouter
ALTER TABLE public.agents 
DROP CONSTRAINT IF EXISTS agents_llm_provider_check;

ALTER TABLE public.agents 
ADD CONSTRAINT agents_llm_provider_check 
CHECK (llm_provider IN ('anthropic', 'deepseek', 'openai', 'openrouter'));

-- Add comment
COMMENT ON COLUMN public.agents.ai_model IS 'Specific AI model to use (e.g., deepseek/deepseek-chat, anthropic/claude-3-opus, openai/gpt-4, etc.)';
COMMENT ON COLUMN public.agents.llm_provider IS 'LLM provider to use for this agent: anthropic, deepseek, openai, or openrouter';