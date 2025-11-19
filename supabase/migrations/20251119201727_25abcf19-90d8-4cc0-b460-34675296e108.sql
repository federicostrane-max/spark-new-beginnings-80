-- WORKAROUND: Ricostruisci full_text dai chunk esistenti per documenti senza testo
-- Questo recupera i documenti che hanno chunks ma non hanno full_text

UPDATE knowledge_documents kd
SET 
  full_text = (
    SELECT string_agg(ak.content, ' ' ORDER BY ak.created_at)
    FROM agent_knowledge ak
    WHERE ak.pool_document_id = kd.id 
      AND ak.agent_id IS NULL
      AND ak.content IS NOT NULL
  ),
  text_length = (
    SELECT length(string_agg(ak.content, ' ' ORDER BY ak.created_at))
    FROM agent_knowledge ak
    WHERE ak.pool_document_id = kd.id 
      AND ak.agent_id IS NULL
      AND ak.content IS NOT NULL
  )
WHERE kd.full_text IS NULL
  AND EXISTS (
    SELECT 1 
    FROM agent_knowledge ak
    WHERE ak.pool_document_id = kd.id 
      AND ak.agent_id IS NULL
      AND ak.content IS NOT NULL
  );