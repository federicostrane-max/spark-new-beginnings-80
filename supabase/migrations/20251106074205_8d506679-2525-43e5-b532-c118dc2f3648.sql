-- Prima rimuove il check constraint esistente
ALTER TABLE knowledge_documents 
DROP CONSTRAINT IF EXISTS knowledge_documents_processing_status_check;

-- Aggiunge un nuovo check constraint che include 'pending_processing'
ALTER TABLE knowledge_documents
ADD CONSTRAINT knowledge_documents_processing_status_check
CHECK (processing_status IN ('downloaded', 'validating', 'validated', 'processing', 'pending_processing', 'ready_for_assignment', 'validation_failed', 'processing_failed'));

-- Corregge i documenti validated senza summary impostandoli come pending_processing
UPDATE knowledge_documents
SET processing_status = 'pending_processing'
WHERE validation_status = 'validated'
  AND (ai_summary IS NULL OR ai_summary = '')
  AND processing_status = 'validated';

-- Crea funzione RPC per contare documenti in elaborazione
CREATE OR REPLACE FUNCTION count_processing_documents()
RETURNS bigint AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM knowledge_documents
    WHERE processing_status IN ('validating', 'processing')
       OR (processing_status = 'pending_processing')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;