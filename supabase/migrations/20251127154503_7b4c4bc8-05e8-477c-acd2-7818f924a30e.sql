-- Drop existing function and recreate with correct signature
DROP FUNCTION IF EXISTS get_agent_sync_status(uuid);

CREATE OR REPLACE FUNCTION get_agent_sync_status(p_agent_id UUID)
RETURNS TABLE (
  document_id UUID,
  document_name TEXT,
  chunk_count BIGINT,
  sync_status TEXT,
  pipeline_source TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;