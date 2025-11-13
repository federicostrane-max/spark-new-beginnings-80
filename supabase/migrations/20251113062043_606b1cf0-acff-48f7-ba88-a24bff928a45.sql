-- Fase 2: Cleanup link falliti per documenti validation_failed
DELETE FROM agent_document_links
WHERE document_id IN (
  SELECT id FROM knowledge_documents
  WHERE validation_status = 'validation_failed'
  OR processing_status = 'validation_failed'
);

-- Fase 6: RLS Policy per prevenire linking di documenti non pronti
CREATE POLICY "prevent_linking_invalid_documents"
ON agent_document_links
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM knowledge_documents
    WHERE id = document_id
    AND processing_status = 'ready_for_assignment'
    AND validation_status = 'validated'
  )
);