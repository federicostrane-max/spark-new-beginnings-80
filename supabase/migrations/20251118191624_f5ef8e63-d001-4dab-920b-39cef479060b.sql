-- Pipeline B: Add support for Landing AI + Nexla chunking strategy
-- Task 1.1: Database Migration

-- Add chunking_strategy column to knowledge_documents
ALTER TABLE knowledge_documents 
ADD COLUMN IF NOT EXISTS chunking_strategy TEXT DEFAULT 'sliding_window' 
CHECK (chunking_strategy IN ('sliding_window', 'landing_ai_nexla'));

-- Add chunking_metadata JSONB column to agent_knowledge
ALTER TABLE agent_knowledge
ADD COLUMN IF NOT EXISTS chunking_metadata JSONB DEFAULT '{}'::jsonb;

-- Create index on chunking_strategy for efficient filtering
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_chunking_strategy 
ON knowledge_documents(chunking_strategy);

-- Add comment for documentation
COMMENT ON COLUMN knowledge_documents.chunking_strategy IS 
'Chunking strategy used: sliding_window (Pipeline A) or landing_ai_nexla (Pipeline B)';

COMMENT ON COLUMN agent_knowledge.chunking_metadata IS 
'Metadata about chunking process: confidence scores, chunk boundaries, semantic coherence';