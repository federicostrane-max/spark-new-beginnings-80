-- Add UNIQUE constraint on file_name to prevent duplicate documents
ALTER TABLE knowledge_documents
ADD CONSTRAINT unique_file_name UNIQUE (file_name);