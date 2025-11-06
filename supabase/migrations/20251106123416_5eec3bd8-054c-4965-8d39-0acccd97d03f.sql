-- Add sync status tracking to agent_document_links
ALTER TABLE agent_document_links 
ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'completed', 'failed')),
ADD COLUMN IF NOT EXISTS sync_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sync_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sync_error TEXT;

-- Create index for efficient queries on sync_status
CREATE INDEX IF NOT EXISTS idx_agent_document_links_sync_status 
ON agent_document_links(sync_status);

-- Update existing records to 'completed' status (assume they are already synced)
UPDATE agent_document_links 
SET sync_status = 'completed', 
    sync_completed_at = created_at 
WHERE sync_status = 'pending';