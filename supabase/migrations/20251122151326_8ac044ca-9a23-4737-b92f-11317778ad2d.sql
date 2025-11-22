
-- Remove unique constraint on file_name (allows same filename in different folders)
-- file_path is already unique and sufficient
ALTER TABLE knowledge_documents DROP CONSTRAINT IF EXISTS unique_file_name;
