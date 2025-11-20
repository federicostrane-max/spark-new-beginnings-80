-- Step 1: Ricrea il trigger per l'enqueue automatico
CREATE OR REPLACE FUNCTION public.enqueue_document_processing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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

  -- Insert into queue
  INSERT INTO document_processing_queue (document_id, processing_type, status)
  VALUES (NEW.id, v_processing_type, 'pending')
  ON CONFLICT (document_id, processing_type) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS enqueue_processing ON knowledge_documents;

-- Create the trigger
CREATE TRIGGER enqueue_processing
  AFTER INSERT OR UPDATE ON knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_document_processing();

-- Step 2: Pulizia completa dei documenti GitHub bloccati

-- 2.1: Elimina chunks associati ai documenti GitHub non assegnabili
DELETE FROM agent_knowledge 
WHERE pool_document_id IN (
  SELECT id FROM knowledge_documents 
  WHERE search_query LIKE 'GitHub:%'
  AND (processing_status != 'ready_for_assignment' OR validation_status != 'validated')
);

-- 2.2: Elimina link associati
DELETE FROM agent_document_links 
WHERE document_id IN (
  SELECT id FROM knowledge_documents 
  WHERE search_query LIKE 'GitHub:%'
  AND (processing_status != 'ready_for_assignment' OR validation_status != 'validated')
);

-- 2.3: Elimina cache di processing
DELETE FROM document_processing_cache
WHERE document_id IN (
  SELECT id FROM knowledge_documents 
  WHERE search_query LIKE 'GitHub:%'
  AND (processing_status != 'ready_for_assignment' OR validation_status != 'validated')
);

-- 2.4: Elimina documenti GitHub non assegnabili
DELETE FROM knowledge_documents 
WHERE search_query LIKE 'GitHub:%'
AND (processing_status != 'ready_for_assignment' OR validation_status != 'validated');

-- 2.5: Svuota completamente la coda di processing per ripartire da zero
TRUNCATE document_processing_queue;