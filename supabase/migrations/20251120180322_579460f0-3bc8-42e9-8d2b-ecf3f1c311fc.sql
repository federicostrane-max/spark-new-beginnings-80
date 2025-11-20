-- Create RPC function to count documents without chunks
CREATE OR REPLACE FUNCTION count_documents_without_chunks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT kd.id)
  INTO doc_count
  FROM knowledge_documents kd
  LEFT JOIN agent_knowledge ak ON ak.pool_document_id = kd.id
  WHERE kd.processing_status = 'ready_for_assignment'
    AND ak.id IS NULL;
  
  RETURN doc_count;
END;
$$;