-- Create processing_jobs table for batch processing tracking
CREATE TABLE processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pipeline_a_hybrid_documents(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  total_batches INTEGER NOT NULL,
  input_file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  chunks_created INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(document_id, batch_index)
);

-- Create indexes for performance
CREATE INDEX idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX idx_processing_jobs_document_id ON processing_jobs(document_id);

-- RLS policies (permissive for system operations)
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on processing_jobs"
  ON processing_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add batch_index column to pipeline_a_hybrid_chunks_raw for ordering
ALTER TABLE pipeline_a_hybrid_chunks_raw 
ADD COLUMN IF NOT EXISTS batch_index INTEGER DEFAULT 0;