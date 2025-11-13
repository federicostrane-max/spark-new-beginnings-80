-- Add metadata tracking fields to knowledge_documents
ALTER TABLE knowledge_documents 
ADD COLUMN IF NOT EXISTS metadata_confidence TEXT CHECK (metadata_confidence IN ('high', 'medium', 'low')),
ADD COLUMN IF NOT EXISTS metadata_extraction_method TEXT CHECK (metadata_extraction_method IN ('vision', 'text', 'chunks', 'filename')),
ADD COLUMN IF NOT EXISTS metadata_extracted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS metadata_verified_online BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS metadata_verified_source TEXT;

-- Add index for filtering by confidence
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_confidence ON knowledge_documents(metadata_confidence);

-- Add index for filtering by extraction method
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_extraction_method ON knowledge_documents(metadata_extraction_method);