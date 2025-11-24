-- Remove ineffective job_id caching from pipeline_b_documents
-- This caching was ineffective because:
-- 1. Duplicate file check prevents re-upload of same filename
-- 2. Deleting document from pool loses the cached job_id
-- 3. Re-uploading causes reprocessing and additional costs

-- Remove the job_id column
ALTER TABLE pipeline_b_documents 
DROP COLUMN IF EXISTS landing_ai_job_id;

-- Remove the index
DROP INDEX IF EXISTS idx_pipeline_b_documents_job_id;