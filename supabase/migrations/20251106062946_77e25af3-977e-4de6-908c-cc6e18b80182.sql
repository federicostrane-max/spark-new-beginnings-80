-- Create optimized function to find orphaned chunks in a single query
CREATE OR REPLACE FUNCTION find_orphaned_chunks()
RETURNS TABLE (
  chunk_id uuid, 
  agent_id uuid, 
  pool_document_id uuid, 
  document_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ak.id as chunk_id,
    ak.agent_id,
    ak.pool_document_id,
    ak.document_name
  FROM agent_knowledge ak
  WHERE ak.source_type IN ('pool', 'shared_pool')
    AND ak.pool_document_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 
      FROM agent_document_links adl
      WHERE adl.agent_id = ak.agent_id
        AND adl.document_id = ak.pool_document_id
    );
$$;