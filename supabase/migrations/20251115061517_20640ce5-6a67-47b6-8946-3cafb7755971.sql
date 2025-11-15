-- Add filter_prompt_id to agent_task_requirements for proper cache invalidation
ALTER TABLE agent_task_requirements 
ADD COLUMN filter_prompt_id UUID REFERENCES filter_agent_prompts(id);

-- Create index for performance
CREATE INDEX idx_agent_task_requirements_filter_prompt 
ON agent_task_requirements(filter_prompt_id);

-- Add comment to explain the purpose
COMMENT ON COLUMN agent_task_requirements.filter_prompt_id IS 'UUID of the filter prompt version used for extraction. Ensures cache invalidation when new filter prompt versions are saved, even if filter_version text is the same.';