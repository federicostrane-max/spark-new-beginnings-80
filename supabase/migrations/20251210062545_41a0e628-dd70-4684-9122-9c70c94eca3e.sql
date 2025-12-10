-- Add columns for GitHub ingestion to pipeline_a_hybrid_documents
ALTER TABLE pipeline_a_hybrid_documents 
ADD COLUMN IF NOT EXISTS full_text TEXT,
ADD COLUMN IF NOT EXISTS repo_url TEXT,
ADD COLUMN IF NOT EXISTS repo_path TEXT;