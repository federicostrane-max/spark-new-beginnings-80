-- Fase 1: Estendi pipeline_a_documents per supportare GitHub files
ALTER TABLE pipeline_a_documents 
ADD COLUMN IF NOT EXISTS full_text TEXT,
ADD COLUMN IF NOT EXISTS repo_url TEXT,
ADD COLUMN IF NOT EXISTS repo_path TEXT;

-- Index per migliorare query performance
CREATE INDEX IF NOT EXISTS idx_pipeline_a_documents_source_type 
ON pipeline_a_documents(source_type);

CREATE INDEX IF NOT EXISTS idx_pipeline_a_documents_repo_url 
ON pipeline_a_documents(repo_url) 
WHERE repo_url IS NOT NULL;