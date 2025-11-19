-- Add folder column to knowledge_documents
ALTER TABLE knowledge_documents 
ADD COLUMN folder TEXT;

-- Create index for better performance
CREATE INDEX idx_knowledge_documents_folder ON knowledge_documents(folder);

-- Update existing GitHub documents to be in the Huggingface_GitHub folder
UPDATE knowledge_documents 
SET folder = 'Huggingface_GitHub'
WHERE search_query LIKE '%GitHub%' OR file_name LIKE '%/%';