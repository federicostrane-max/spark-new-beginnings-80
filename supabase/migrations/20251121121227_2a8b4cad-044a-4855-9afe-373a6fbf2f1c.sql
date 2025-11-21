-- Fix find_orphaned_chunks to exclude shared pool chunks
-- Shared pool chunks (agent_id IS NULL) should NEVER be considered orphaned
CREATE OR REPLACE FUNCTION public.find_orphaned_chunks()
RETURNS TABLE(chunk_id uuid, agent_id uuid, pool_document_id uuid, document_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    ak.id as chunk_id,
    ak.agent_id,
    ak.pool_document_id,
    ak.document_name
  FROM agent_knowledge ak
  WHERE ak.source_type IN ('pool', 'shared_pool')
    AND ak.pool_document_id IS NOT NULL
    AND ak.agent_id IS NOT NULL  -- CRITICAL: Exclude shared pool chunks
    AND NOT EXISTS (
      SELECT 1 
      FROM agent_document_links adl
      WHERE adl.agent_id = ak.agent_id
        AND adl.document_id = ak.pool_document_id
    );
$$;