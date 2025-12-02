-- Add retry_count column to processing_jobs if not exists
ALTER TABLE processing_jobs 
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Add updated_at column for tracking stuck jobs
ALTER TABLE processing_jobs 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index for efficient stuck job detection
CREATE INDEX IF NOT EXISTS idx_processing_jobs_stuck_detection 
ON processing_jobs (status, updated_at) 
WHERE status = 'processing';

-- ===================================================================
-- CLEANUP COMPLETO DATI FINANCEBENCH
-- ===================================================================

-- 1. Eliminare processing_jobs per documenti FinanceBench
DELETE FROM processing_jobs 
WHERE document_id IN (
  SELECT id FROM pipeline_a_hybrid_documents 
  WHERE file_name LIKE 'financebench_%'
);

-- 2. Eliminare agent knowledge assignments per chunks FinanceBench
DELETE FROM pipeline_a_hybrid_agent_knowledge
WHERE chunk_id IN (
  SELECT c.id FROM pipeline_a_hybrid_chunks_raw c
  JOIN pipeline_a_hybrid_documents d ON d.id = c.document_id
  WHERE d.file_name LIKE 'financebench_%'
);

-- 3. Eliminare chunks da pipeline_a_hybrid_chunks_raw
DELETE FROM pipeline_a_hybrid_chunks_raw
WHERE document_id IN (
  SELECT id FROM pipeline_a_hybrid_documents 
  WHERE file_name LIKE 'financebench_%'
);

-- 4. Eliminare documenti da pipeline_a_hybrid_documents
DELETE FROM pipeline_a_hybrid_documents
WHERE file_name LIKE 'financebench_%';

-- 5. Eliminare Q&A da benchmark_datasets
DELETE FROM benchmark_datasets
WHERE suite_category = 'financebench';