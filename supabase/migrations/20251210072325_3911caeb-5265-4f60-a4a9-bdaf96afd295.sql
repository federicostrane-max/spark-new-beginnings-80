-- Create update function if not exists
CREATE OR REPLACE FUNCTION update_github_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create github_processing_jobs table for sequential job queue processing
CREATE TABLE github_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pipeline_a_hybrid_documents(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for efficient queue queries
CREATE INDEX idx_github_jobs_status ON github_processing_jobs(status);
CREATE INDEX idx_github_jobs_document ON github_processing_jobs(document_id);
CREATE INDEX idx_github_jobs_status_created ON github_processing_jobs(status, created_at);

-- Enable RLS
ALTER TABLE github_processing_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "System can manage github jobs"
  ON github_processing_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read github jobs"
  ON github_processing_jobs
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_github_jobs_updated_at
  BEFORE UPDATE ON github_processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_github_jobs_updated_at();