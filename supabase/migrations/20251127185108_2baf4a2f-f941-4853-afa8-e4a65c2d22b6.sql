-- Reset Pipeline A-Hybrid document for re-processing
-- This fixes the document that was incorrectly marked as 'ready' despite having no chunks

-- Reset document status to 'ingested' to restart the processing pipeline
UPDATE pipeline_a_hybrid_documents 
SET 
  status = 'ingested', 
  processed_at = null,
  error_message = null,
  llamaparse_job_id = null,
  page_count = null,
  processing_metadata = null,
  updated_at = now()
WHERE id = '7651b225-773e-4ac8-8e6c-bdc96c600217';

-- Remove any orphan chunks (should not exist, but ensures clean state)
DELETE FROM pipeline_a_hybrid_chunks_raw 
WHERE document_id = '7651b225-773e-4ac8-8e6c-bdc96c600217';