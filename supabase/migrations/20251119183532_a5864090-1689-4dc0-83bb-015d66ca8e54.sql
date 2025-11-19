-- Create table for storing document assignment backups
CREATE TABLE document_assignment_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_name TEXT NOT NULL,
  backup_description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  
  -- Snapshot of assignments at backup time
  assignments JSONB NOT NULL,
  
  -- Metadata
  documents_count INT NOT NULL,
  assignments_count INT NOT NULL,
  files_found INT NOT NULL DEFAULT 0,
  files_missing INT NOT NULL DEFAULT 0,
  
  -- Restoration tracking
  restored_at TIMESTAMPTZ,
  restored_by UUID
);

-- Enable RLS
ALTER TABLE document_assignment_backups ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view all backups
CREATE POLICY "Users can view all backups"
  ON document_assignment_backups FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Allow system to manage backups
CREATE POLICY "System can manage backups"
  ON document_assignment_backups FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_document_assignment_backups_created_at 
  ON document_assignment_backups(created_at DESC);