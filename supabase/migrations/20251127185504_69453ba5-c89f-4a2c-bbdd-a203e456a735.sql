-- Add Pipeline A-Hybrid support to get_agent_sync_status RPC
-- This fixes the 500 error in check-agent-health by including hybrid pipeline documents

CREATE OR REPLACE FUNCTION public.get_agent_sync_status(p_agent_id uuid)
 RETURNS TABLE(document_id uuid, document_name text, chunk_count bigint, sync_status text, pipeline_source text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  -- Pipeline A documents
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    COUNT(ak.chunk_id) as chunk_count,
    'completed'::TEXT as sync_status,
    'pipeline_a'::TEXT as pipeline_source
  FROM pipeline_a_documents d
  INNER JOIN pipeline_a_agent_knowledge ak ON ak.agent_id = p_agent_id
  INNER JOIN pipeline_a_chunks_raw c ON c.id = ak.chunk_id AND c.document_id = d.id
  WHERE ak.agent_id = p_agent_id
  GROUP BY d.id, d.file_name

  UNION ALL

  -- Pipeline A-Hybrid documents
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    COUNT(ak.chunk_id) as chunk_count,
    'completed'::TEXT as sync_status,
    'pipeline_a_hybrid'::TEXT as pipeline_source
  FROM pipeline_a_hybrid_documents d
  INNER JOIN pipeline_a_hybrid_agent_knowledge ak ON ak.agent_id = p_agent_id
  INNER JOIN pipeline_a_hybrid_chunks_raw c ON c.id = ak.chunk_id AND c.document_id = d.id
  WHERE ak.agent_id = p_agent_id
  GROUP BY d.id, d.file_name

  UNION ALL

  -- Pipeline B documents
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    COUNT(ak.chunk_id) as chunk_count,
    'completed'::TEXT as sync_status,
    'pipeline_b'::TEXT as pipeline_source
  FROM pipeline_b_documents d
  INNER JOIN pipeline_b_agent_knowledge ak ON ak.agent_id = p_agent_id
  INNER JOIN pipeline_b_chunks_raw c ON c.id = ak.chunk_id AND c.document_id = d.id
  WHERE ak.agent_id = p_agent_id
  GROUP BY d.id, d.file_name

  UNION ALL

  -- Pipeline C documents
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    COUNT(ak.chunk_id) as chunk_count,
    'completed'::TEXT as sync_status,
    'pipeline_c'::TEXT as pipeline_source
  FROM pipeline_c_documents d
  INNER JOIN pipeline_c_agent_knowledge ak ON ak.agent_id = p_agent_id
  INNER JOIN pipeline_c_chunks_raw c ON c.id = ak.chunk_id AND c.document_id = d.id
  WHERE ak.agent_id = p_agent_id
  GROUP BY d.id, d.file_name;
END;
$function$;