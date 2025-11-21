-- Remove existing UNIQUE constraint on file_name
ALTER TABLE knowledge_documents DROP CONSTRAINT IF EXISTS knowledge_documents_file_name_key;

-- Add UNIQUE constraint on file_path (full path is unique)
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_file_path_key UNIQUE (file_path);