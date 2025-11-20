-- ===================================================================
-- STEP 1: Ricrea trigger semplificato SENZA net.http_post
-- ===================================================================

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS enqueue_processing ON knowledge_documents;
DROP FUNCTION IF EXISTS enqueue_document_processing();

-- Create simplified enqueue function (NO http_post, just insert into queue)
CREATE OR REPLACE FUNCTION enqueue_document_processing()
RETURNS TRIGGER AS $$
DECLARE
  v_processing_type text;
BEGIN
  -- Determine processing type based on status changes
  IF NEW.processing_status = 'pending_processing' AND 
     (OLD IS NULL OR OLD.processing_status IS DISTINCT FROM 'pending_processing') THEN
    v_processing_type := 'extract';
  ELSIF NEW.processing_status = 'ready_for_assignment' AND 
        NEW.validation_status = 'pending' AND
        (OLD IS NULL OR OLD.processing_status IS DISTINCT FROM 'ready_for_assignment' OR 
         OLD.validation_status IS DISTINCT FROM 'pending') THEN
    v_processing_type := 'validate';
  ELSE
    RETURN NEW;
  END IF;

  -- Insert into queue (simple, no complex ON CONFLICT)
  INSERT INTO document_processing_queue (document_id, processing_type, status)
  VALUES (NEW.id, v_processing_type, 'pending')
  ON CONFLICT (document_id, processing_type) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
CREATE TRIGGER enqueue_processing
  AFTER INSERT OR UPDATE OF processing_status, validation_status
  ON knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_document_processing();

-- ===================================================================
-- STEP 2: Setup cron job for automatic queue processing (every minute)
-- ===================================================================

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any existing jobs (ignore errors if not exists)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) 
  FROM cron.job 
  WHERE jobname = 'process-document-queue-auto';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule automatic queue processing every minute
SELECT cron.schedule(
  'process-document-queue-auto',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/process-document-queue',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{"batchSize": 50}'::jsonb
  );
  $$
);

-- ===================================================================
-- STEP 3: Reset blocked documents to trigger processing
-- ===================================================================

-- Reset pending_processing documents (193 found)
UPDATE knowledge_documents
SET updated_at = NOW()
WHERE processing_status = 'pending_processing';

-- Reset ready_for_assignment with validation pending (272 found)
UPDATE knowledge_documents  
SET updated_at = NOW()
WHERE processing_status = 'ready_for_assignment' 
AND validation_status = 'pending';