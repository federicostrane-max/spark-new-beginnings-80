
-- Remove problematic check constraint that blocks inserts
ALTER TABLE knowledge_documents DROP CONSTRAINT IF EXISTS knowledge_documents_validation_status_check;

-- Recreate it correctly to allow 'validated' status
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_validation_status_check 
  CHECK (validation_status IN ('pending', 'validating', 'validated', 'validation_failed'));
