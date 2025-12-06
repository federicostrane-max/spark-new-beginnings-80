-- Add extraction mode tracking to pipeline_a_hybrid_documents
ALTER TABLE public.pipeline_a_hybrid_documents 
ADD COLUMN IF NOT EXISTS extraction_mode TEXT DEFAULT 'auto',
ADD COLUMN IF NOT EXISTS extraction_attempts INTEGER DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN public.pipeline_a_hybrid_documents.extraction_mode IS 'Extraction mode used: auto | multimodal';
COMMENT ON COLUMN public.pipeline_a_hybrid_documents.extraction_attempts IS 'Number of extraction attempts (max 2 to prevent infinite loops)';