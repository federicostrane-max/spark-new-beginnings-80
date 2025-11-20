-- =====================================================
-- SISTEMA PROFESSIONALE DI PROCESSING AUTOMATICO
-- Database Triggers per Processing Asincrono
-- =====================================================

-- Step 1: Creare funzione per invocare process-document
CREATE OR REPLACE FUNCTION trigger_process_document()
RETURNS TRIGGER AS $$
BEGIN
  -- Invoca l'edge function in background usando pg_net
  PERFORM net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/process-document',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY'
    ),
    body := jsonb_build_object(
      'documentId', NEW.id::text
    )
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error ma non bloccare l'operazione
  RAISE WARNING 'Failed to trigger process-document for doc %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Creare trigger per documenti in pending_processing
DROP TRIGGER IF EXISTS auto_process_pending_documents ON knowledge_documents;

CREATE TRIGGER auto_process_pending_documents
  AFTER INSERT OR UPDATE OF processing_status
  ON knowledge_documents
  FOR EACH ROW
  WHEN (NEW.processing_status = 'pending_processing')
  EXECUTE FUNCTION trigger_process_document();

-- Step 3: Creare funzione per invocare validate-document
CREATE OR REPLACE FUNCTION trigger_validate_document()
RETURNS TRIGGER AS $$
BEGIN
  -- Invoca l'edge function in background
  PERFORM net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/validate-document',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY'
    ),
    body := jsonb_build_object(
      'documentId', NEW.id::text,
      'searchQuery', COALESCE(NEW.search_query, ''),
      'extractedText', COALESCE(substring(NEW.full_text from 1 for 1000), '')
    )
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error ma non bloccare l'operazione
  RAISE WARNING 'Failed to trigger validate-document for doc %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Creare trigger per documenti pronti per validazione
DROP TRIGGER IF EXISTS auto_validate_ready_documents ON knowledge_documents;

CREATE TRIGGER auto_validate_ready_documents
  AFTER UPDATE OF processing_status
  ON knowledge_documents
  FOR EACH ROW
  WHEN (
    OLD.processing_status != 'ready_for_assignment' AND 
    NEW.processing_status = 'ready_for_assignment' AND
    NEW.validation_status = 'pending'
  )
  EXECUTE FUNCTION trigger_validate_document();

-- Step 5: Pulire documenti in stato inconsistente (262 documenti)
-- Riportiamo a pending_processing tutti i documenti ready_for_assignment senza chunks
UPDATE knowledge_documents
SET 
  processing_status = 'pending_processing',
  validation_status = 'pending',
  processed_at = NULL
WHERE 
  processing_status = 'ready_for_assignment'
  AND validation_status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM agent_knowledge 
    WHERE pool_document_id = knowledge_documents.id
  );

COMMENT ON FUNCTION trigger_process_document() IS 
'Invoca automaticamente process-document quando un documento entra in pending_processing';

COMMENT ON FUNCTION trigger_validate_document() IS 
'Invoca automaticamente validate-document quando un documento raggiunge ready_for_assignment';

COMMENT ON TRIGGER auto_process_pending_documents ON knowledge_documents IS 
'Trigger automatico per processing di documenti PDF e Markdown';

COMMENT ON TRIGGER auto_validate_ready_documents ON knowledge_documents IS 
'Trigger automatico per validazione AI di documenti processati';