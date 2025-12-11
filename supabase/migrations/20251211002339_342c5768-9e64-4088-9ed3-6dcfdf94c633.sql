-- Add start_url column to browser_tasks table
ALTER TABLE browser_tasks ADD COLUMN IF NOT EXISTS start_url TEXT;