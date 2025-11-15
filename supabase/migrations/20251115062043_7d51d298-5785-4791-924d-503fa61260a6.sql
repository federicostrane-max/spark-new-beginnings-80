-- Drop the old unique constraint if it exists
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'agent_task_requirements_agent_id_key'
  ) THEN
    ALTER TABLE agent_task_requirements 
    DROP CONSTRAINT agent_task_requirements_agent_id_key;
  END IF;
END $$;

-- Create new unique constraint with filter_prompt_id
-- This allows multiple extractions per agent if filter prompt changes
ALTER TABLE agent_task_requirements
ADD CONSTRAINT agent_task_requirements_unique_extraction
UNIQUE (agent_id, system_prompt_hash, extraction_model, filter_prompt_id);

COMMENT ON CONSTRAINT agent_task_requirements_unique_extraction ON agent_task_requirements 
IS 'Ensures one extraction per combination of agent, system prompt, LLM model, and filter prompt version';