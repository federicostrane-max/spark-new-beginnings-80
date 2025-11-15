-- Add llm_model column to filter_agent_prompts table
ALTER TABLE filter_agent_prompts 
ADD COLUMN llm_model TEXT DEFAULT 'google/gemini-2.5-flash';

-- Set default for existing records
UPDATE filter_agent_prompts 
SET llm_model = 'google/gemini-2.5-flash' 
WHERE llm_model IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN filter_agent_prompts.llm_model IS 'LLM model used for task requirement extraction (e.g., google/gemini-2.5-flash, openai/gpt-5)';