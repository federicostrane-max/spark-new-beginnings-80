-- Drop the old constraint that only allowed anthropic, deepseek, openai, openrouter
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_llm_provider_check;

-- Add the new constraint with all providers including google, mistral, x-ai
ALTER TABLE agents ADD CONSTRAINT agents_llm_provider_check 
CHECK (llm_provider = ANY (ARRAY[
  'anthropic'::text, 
  'deepseek'::text, 
  'openai'::text, 
  'openrouter'::text,
  'google'::text,
  'mistral'::text,
  'x-ai'::text
]));