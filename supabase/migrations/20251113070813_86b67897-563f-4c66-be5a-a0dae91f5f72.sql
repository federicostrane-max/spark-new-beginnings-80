-- Add metadata extraction fields to knowledge_documents
ALTER TABLE knowledge_documents 
ADD COLUMN IF NOT EXISTS extracted_title TEXT,
ADD COLUMN IF NOT EXISTS extracted_authors TEXT[];

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_extracted_title 
ON knowledge_documents USING gin(to_tsvector('english', extracted_title));

COMMENT ON COLUMN knowledge_documents.extracted_title IS 'Titolo estratto dai metadati del PDF tramite AI';
COMMENT ON COLUMN knowledge_documents.extracted_authors IS 'Autori estratti dai metadati del PDF tramite AI';