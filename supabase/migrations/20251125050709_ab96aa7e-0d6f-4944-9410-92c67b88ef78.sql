-- Fix CHECK constraint on pipeline_b_documents.status to include 'ready'
-- This constraint was blocking documents from being marked as assignable

ALTER TABLE pipeline_b_documents 
DROP CONSTRAINT IF EXISTS pipeline_b_documents_status_check;

ALTER TABLE pipeline_b_documents 
ADD CONSTRAINT pipeline_b_documents_status_check 
CHECK (status IN ('ingested', 'processing', 'chunked', 'ready', 'failed'));