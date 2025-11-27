-- Drop the existing function
DROP FUNCTION IF EXISTS public.get_agent_sync_status(uuid);

-- Create the fixed version that only returns assigned documents
CREATE OR REPLACE FUNCTION public.get_agent_sync_status(p_agent_id uuid)
RETURNS TABLE(document_id uuid, document_name text, sync_status text, chunk_count bigint, pipeline_source text)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  
  -- Pipeline A - ONLY documents with chunks assigned to this agent
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    'completed'::text as sync_status,
    COUNT(ak.chunk_id)::bigint as chunk_count,
    'pipeline_a'::text as pipeline_source
  FROM pipeline_a_agent_knowledge ak
  JOIN pipeline_a_chunks_raw c ON c.id = ak.chunk_id AND c.embedding_status = 'ready'
  JOIN pipeline_a_documents d ON d.id = c.document_id AND d.status = 'ready'
  WHERE ak.agent_id = p_agent_id AND ak.is_active = true
  GROUP BY d.id, d.file_name
  
  UNION ALL
  
  -- Pipeline B - ONLY documents with chunks assigned to this agent  
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    'completed'::text as sync_status,
    COUNT(ak.chunk_id)::bigint as chunk_count,
    'pipeline_b'::text as pipeline_source
  FROM pipeline_b_agent_knowledge ak
  JOIN pipeline_b_chunks_raw c ON c.id = ak.chunk_id AND c.embedding_status = 'ready'
  JOIN pipeline_b_documents d ON d.id = c.document_id AND d.status = 'ready'
  WHERE ak.agent_id = p_agent_id AND ak.is_active = true
  GROUP BY d.id, d.file_name
  
  UNION ALL
  
  -- Pipeline C - ONLY documents with chunks assigned to this agent
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    'completed'::text as sync_status,
    COUNT(ak.chunk_id)::bigint as chunk_count,
    'pipeline_c'::text as pipeline_source
  FROM pipeline_c_agent_knowledge ak
  JOIN pipeline_c_chunks_raw c ON c.id = ak.chunk_id AND c.embedding_status = 'ready'
  JOIN pipeline_c_documents d ON d.id = c.document_id AND d.status = 'ready'
  WHERE ak.agent_id = p_agent_id AND ak.is_active = true
  GROUP BY d.id, d.file_name;
END;
$function$;