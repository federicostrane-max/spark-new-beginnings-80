-- Add metadata column to agent_messages table for tracking knowledge base usage
ALTER TABLE agent_messages 
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Create GIN index for fast metadata queries
CREATE INDEX IF NOT EXISTS idx_agent_messages_metadata 
ON agent_messages USING gin(metadata);

-- Add comment
COMMENT ON COLUMN agent_messages.metadata IS 
'Tracking info: has_knowledge_context, knowledge_stats, tools_used, source_reliability';