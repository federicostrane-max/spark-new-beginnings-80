-- Remove foreign key constraint on benchmark_datasets.document_id
-- to allow referencing documents from any pipeline (A, A-Hybrid, B, C)
ALTER TABLE benchmark_datasets 
DROP CONSTRAINT benchmark_datasets_document_id_fkey;