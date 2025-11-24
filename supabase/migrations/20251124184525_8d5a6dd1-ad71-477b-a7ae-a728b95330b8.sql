-- Add landing_ai_job_id column to pipeline_b_documents for caching
ALTER TABLE pipeline_b_documents 
ADD COLUMN IF NOT EXISTS landing_ai_job_id TEXT;

-- Add index for faster job_id lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_b_documents_job_id 
ON pipeline_b_documents(landing_ai_job_id) 
WHERE landing_ai_job_id IS NOT NULL;