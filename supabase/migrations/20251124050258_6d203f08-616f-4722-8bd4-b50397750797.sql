
-- Fix get_distinct_documents to count by pool_document_id instead of document_name
-- This ensures all documents are counted, even if they have the same filename in different folders

DROP FUNCTION IF EXISTS public.get_distinct_documents(uuid);

CREATE OR REPLACE FUNCTION public.get_distinct_documents(p_agent_id uuid)
RETURNS TABLE(
  id uuid, 
  document_name text, 
  category text, 
  summary text, 
  created_at timestamp with time zone,
  pool_document_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  -- For shared pool documents (agent_id IS NULL)
  SELECT DISTINCT ON (ak.pool_document_id)
    ak.id,
    ak.document_name,
    ak.category,
    ak.summary,
    ak.created_at,
    ak.pool_document_id
  FROM agent_knowledge ak
  JOIN agent_document_links adl ON adl.document_id = ak.pool_document_id
  WHERE adl.agent_id = p_agent_id
    AND ak.agent_id IS NULL  -- Shared pool chunks
    AND ak.is_active = true
    AND adl.sync_status = 'completed'
  
  UNION ALL
  
  -- For direct upload documents (agent-specific, pool_document_id IS NULL)
  SELECT DISTINCT ON (ak.document_name)
    ak.id,
    ak.document_name,
    ak.category,
    ak.summary,
    ak.created_at,
    ak.pool_document_id
  FROM agent_knowledge ak
  WHERE ak.agent_id = p_agent_id
    AND ak.pool_document_id IS NULL
    AND ak.is_active = true
  
  ORDER BY pool_document_id NULLS LAST, created_at DESC;
END;
$$;
