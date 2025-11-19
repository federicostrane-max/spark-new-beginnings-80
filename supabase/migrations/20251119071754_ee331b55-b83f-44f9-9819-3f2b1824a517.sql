-- Add full_text column to knowledge_documents for storing Markdown content
ALTER TABLE knowledge_documents 
ADD COLUMN full_text TEXT;

-- Add index for better performance when querying by full_text presence
CREATE INDEX idx_knowledge_documents_full_text_present 
ON knowledge_documents ((full_text IS NOT NULL));