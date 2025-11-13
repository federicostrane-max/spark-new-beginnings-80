-- FASE 1: Fix documenti esistenti senza chunk
-- Trova e aggiorna i path dei documenti nel pool che non hanno chunk

-- Step 1: Identifica documenti con file_path che inizia con timestamp
-- e aggiornali al formato standard shared-pool-uploads/filename.pdf

DO $$
DECLARE
  doc RECORD;
  new_path TEXT;
BEGIN
  -- Trova tutti i documenti nel pool senza chunk
  FOR doc IN 
    SELECT kd.id, kd.file_name, kd.file_path
    FROM knowledge_documents kd
    WHERE kd.processing_status IN ('validated', 'ready_for_assignment')
      AND NOT EXISTS (
        SELECT 1 FROM agent_knowledge ak 
        WHERE ak.pool_document_id = kd.id 
          AND ak.agent_id IS NULL
      )
  LOOP
    -- Se il file_path contiene timestamp, puliscilo
    IF doc.file_path ~ '^\d+_' THEN
      new_path := 'shared-pool-uploads/' || doc.file_name;
      
      RAISE NOTICE 'Updating document % from % to %', doc.id, doc.file_path, new_path;
      
      UPDATE knowledge_documents
      SET file_path = new_path,
          processing_status = 'pending_processing'
      WHERE id = doc.id;
    ELSIF doc.file_path NOT LIKE 'shared-pool-uploads/%' THEN
      -- Se non ha il prefisso corretto, aggiungilo
      new_path := 'shared-pool-uploads/' || doc.file_name;
      
      RAISE NOTICE 'Standardizing path for document % from % to %', doc.id, doc.file_path, new_path;
      
      UPDATE knowledge_documents
      SET file_path = new_path,
          processing_status = 'pending_processing'
      WHERE id = doc.id;
    END IF;
  END LOOP;
END $$;

-- Step 2: Log i documenti che necessitano riprocessamento
INSERT INTO maintenance_execution_logs (
  execution_status,
  documents_fixed,
  details,
  execution_completed_at
)
SELECT 
  'completed',
  COUNT(*),
  jsonb_build_object(
    'action', 'fix_documents_without_chunks',
    'timestamp', NOW(),
    'documents_affected', jsonb_agg(
      jsonb_build_object(
        'id', id,
        'file_name', file_name,
        'old_path', file_path
      )
    )
  ),
  NOW()
FROM knowledge_documents
WHERE processing_status = 'pending_processing'
  AND NOT EXISTS (
    SELECT 1 FROM agent_knowledge ak 
    WHERE ak.pool_document_id = id 
      AND ak.agent_id IS NULL
  );