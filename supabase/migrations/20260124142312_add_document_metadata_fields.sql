-- Add document-level metadata fields to pipeline_a_hybrid_documents
-- These fields store AI-generated analysis for document preview and filtering

ALTER TABLE pipeline_a_hybrid_documents
ADD COLUMN IF NOT EXISTS ai_summary TEXT,
ADD COLUMN IF NOT EXISTS keywords TEXT[],
ADD COLUMN IF NOT EXISTS topics TEXT[],
ADD COLUMN IF NOT EXISTS complexity_level TEXT CHECK (complexity_level IS NULL OR complexity_level IN ('basic', 'intermediate', 'advanced'));

-- Create index for filtering by complexity
CREATE INDEX IF NOT EXISTS idx_pipeline_a_hybrid_documents_complexity
ON pipeline_a_hybrid_documents(complexity_level);

-- Also add to pipeline_b_documents if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pipeline_b_documents') THEN
    ALTER TABLE pipeline_b_documents
    ADD COLUMN IF NOT EXISTS ai_summary TEXT,
    ADD COLUMN IF NOT EXISTS keywords TEXT[],
    ADD COLUMN IF NOT EXISTS topics TEXT[],
    ADD COLUMN IF NOT EXISTS complexity_level TEXT CHECK (complexity_level IS NULL OR complexity_level IN ('basic', 'intermediate', 'advanced'));
  END IF;
END $$;

-- Comment for documentation
COMMENT ON COLUMN pipeline_a_hybrid_documents.ai_summary IS 'AI-generated brief summary of the document content';
COMMENT ON COLUMN pipeline_a_hybrid_documents.keywords IS 'AI-extracted keywords for search and filtering';
COMMENT ON COLUMN pipeline_a_hybrid_documents.topics IS 'AI-identified main topics covered in the document';
COMMENT ON COLUMN pipeline_a_hybrid_documents.complexity_level IS 'AI-assessed complexity level: basic, intermediate, or advanced';
