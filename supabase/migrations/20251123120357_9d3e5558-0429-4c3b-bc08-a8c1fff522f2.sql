-- Funzione per contare i chunks dei documenti in modo efficiente
CREATE OR REPLACE FUNCTION public.get_document_chunks_count(document_ids uuid[])
RETURNS TABLE(document_id uuid, chunk_count bigint) 
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pool_document_id as document_id,
    COUNT(*) as chunk_count
  FROM agent_knowledge
  WHERE pool_document_id = ANY(document_ids)
    AND agent_id IS NULL
    AND is_active = true
  GROUP BY pool_document_id;
END;
$$;