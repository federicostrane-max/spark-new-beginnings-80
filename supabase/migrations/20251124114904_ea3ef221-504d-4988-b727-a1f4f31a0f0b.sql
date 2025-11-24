-- Add chunk_type column to agent_knowledge for Landing AI integration
ALTER TABLE agent_knowledge 
ADD COLUMN IF NOT EXISTS chunk_type TEXT DEFAULT 'text';

-- Add index for filtering by chunk type
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_chunk_type 
ON agent_knowledge(chunk_type);

-- Add comment to explain the field
COMMENT ON COLUMN agent_knowledge.chunk_type IS 'Type of chunk from Landing AI: text, table, chart, list, header, footer, image';