-- Drop existing trigger and function to recreate them
DROP TRIGGER IF EXISTS enqueue_processing ON knowledge_documents;
DROP FUNCTION IF EXISTS enqueue_document_processing();

-- Create improved enqueue function with automatic queue processing
CREATE OR REPLACE FUNCTION enqueue_document_processing()
RETURNS TRIGGER AS $$
DECLARE
  v_processing_type text;
  v_supabase_url text := 'https://vjeafbnkycxfzpxwkifw.supabase.co';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY';
BEGIN
  -- Determine processing type based on status changes
  IF NEW.processing_status = 'pending_processing' AND 
     (OLD.processing_status IS NULL OR OLD.processing_status != 'pending_processing') THEN
    v_processing_type := 'extract';
  ELSIF NEW.processing_status = 'ready_for_assignment' AND NEW.validation_status = 'pending' AND
        (OLD.processing_status IS NULL OR OLD.processing_status != 'ready_for_assignment' OR 
         OLD.validation_status IS NULL OR OLD.validation_status != 'pending') THEN
    v_processing_type := 'validate';
  ELSE
    RETURN NEW;
  END IF;

  -- Insert into queue
  INSERT INTO document_processing_queue (document_id, processing_type, status)
  VALUES (NEW.id, v_processing_type, 'pending')
  ON CONFLICT (document_id, processing_type) 
  WHERE status IN ('pending', 'processing')
  DO NOTHING;

  -- Trigger async processing via HTTP request (fire-and-forget)
  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/process-document-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := jsonb_build_object('batchSize', 10)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
CREATE TRIGGER enqueue_processing
  AFTER INSERT OR UPDATE OF processing_status, validation_status
  ON knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_document_processing();