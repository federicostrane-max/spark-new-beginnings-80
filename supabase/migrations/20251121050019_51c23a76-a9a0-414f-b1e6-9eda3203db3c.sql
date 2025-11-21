-- Fix count_documents_without_chunks() function to prevent oscillations
CREATE OR REPLACE FUNCTION count_documents_without_chunks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  zombie_count INTEGER;
BEGIN
  -- Count documents marked ready but with NO active shared pool chunks
  -- Uses DISTINCT and LIMIT 1 for stability
  SELECT COUNT(DISTINCT kd.id) INTO zombie_count
  FROM knowledge_documents kd
  WHERE kd.processing_status = 'ready_for_assignment'
    AND NOT EXISTS (
      SELECT 1 
      FROM agent_knowledge ak 
      WHERE ak.pool_document_id = kd.id 
        AND ak.agent_id IS NULL 
        AND ak.is_active = true
      LIMIT 1
    );
  
  RETURN COALESCE(zombie_count, 0);
END;
$$;