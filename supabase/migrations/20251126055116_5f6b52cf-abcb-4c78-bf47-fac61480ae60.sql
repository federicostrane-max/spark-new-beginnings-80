-- Add folder column to all three pipeline document tables
ALTER TABLE pipeline_a_documents ADD COLUMN IF NOT EXISTS folder TEXT;
ALTER TABLE pipeline_b_documents ADD COLUMN IF NOT EXISTS folder TEXT;
ALTER TABLE pipeline_c_documents ADD COLUMN IF NOT EXISTS folder TEXT;

-- Add indexes for folder queries performance
CREATE INDEX IF NOT EXISTS idx_pipeline_a_documents_folder ON pipeline_a_documents(folder);
CREATE INDEX IF NOT EXISTS idx_pipeline_b_documents_folder ON pipeline_b_documents(folder);
CREATE INDEX IF NOT EXISTS idx_pipeline_c_documents_folder ON pipeline_c_documents(folder);