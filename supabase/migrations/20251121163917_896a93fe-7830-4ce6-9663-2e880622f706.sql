-- Add parent_folder column to folders table for hierarchy
ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_folder TEXT;

-- Create index for faster parent lookups
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_folder);

-- Create github_import_progress table for tracking import status
CREATE TABLE IF NOT EXISTS github_import_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo TEXT NOT NULL,
  folder TEXT NOT NULL,
  total_files INTEGER DEFAULT 0,
  downloaded INTEGER DEFAULT 0,
  processed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  status TEXT CHECK (status IN ('discovering', 'downloading', 'processing', 'completed', 'failed')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_github_import_repo ON github_import_progress(repo);
CREATE INDEX IF NOT EXISTS idx_github_import_status ON github_import_progress(status);
CREATE INDEX IF NOT EXISTS idx_github_import_started_at ON github_import_progress(started_at DESC);

-- Enable RLS
ALTER TABLE github_import_progress ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read import progress
CREATE POLICY "Authenticated users can read import progress"
  ON github_import_progress
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow system to manage import progress
CREATE POLICY "System can manage import progress"
  ON github_import_progress
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);