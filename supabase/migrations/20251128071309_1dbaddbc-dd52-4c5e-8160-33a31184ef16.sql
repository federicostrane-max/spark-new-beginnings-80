
-- Recreate get_agent_sync_status RPC for Pipeline A, B, C only
CREATE OR REPLACE FUNCTION get_agent_sync_status(p_agent_id UUID)
RETURNS TABLE (
  document_id UUID,
  document_name TEXT,
  chunk_count BIGINT,
  sync_status TEXT,
  pipeline_source TEXT
) AS $$
BEGIN
  RETURN QUERY
  
  -- Pipeline A documents
  SELECT 
    d.id AS document_id,
    d.file_name AS document_name,
    COUNT(c.id) AS chunk_count,
    'completed'::TEXT AS sync_status,
    'pipeline_a'::TEXT AS pipeline_source
  FROM pipeline_a_documents d
  INNER JOIN pipeline_a_agent_knowledge ak ON d.id = ak.chunk_id
  INNER JOIN pipeline_a_chunks_raw c ON c.document_id = d.id
  WHERE ak.agent_id = p_agent_id
  GROUP BY d.id, d.file_name
  
  UNION ALL
  
  -- Pipeline B documents
  SELECT 
    d.id AS document_id,
    d.file_name AS document_name,
    COUNT(c.id) AS chunk_count,
    'completed'::TEXT AS sync_status,
    'pipeline_b'::TEXT AS pipeline_source
  FROM pipeline_b_documents d
  INNER JOIN pipeline_b_agent_knowledge ak ON d.id = ak.chunk_id
  INNER JOIN pipeline_b_chunks_raw c ON c.document_id = d.id
  WHERE ak.agent_id = p_agent_id
  GROUP BY d.id, d.file_name
  
  UNION ALL
  
  -- Pipeline C documents
  SELECT 
    d.id AS document_id,
    d.file_name AS document_name,
    COUNT(c.id) AS chunk_count,
    'completed'::TEXT AS sync_status,
    'pipeline_c'::TEXT AS pipeline_source
  FROM pipeline_c_documents d
  INNER JOIN pipeline_c_agent_knowledge ak ON d.id = ak.chunk_id
  INNER JOIN pipeline_c_chunks_raw c ON c.document_id = d.id
  WHERE ak.agent_id = p_agent_id
  GROUP BY d.id, d.file_name;
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
