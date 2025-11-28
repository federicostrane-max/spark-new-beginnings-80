
-- Fix get_agent_sync_status RPC with correct JOINs
DROP FUNCTION IF EXISTS get_agent_sync_status(UUID);

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
    COUNT(DISTINCT c.id) AS chunk_count,
    'completed'::TEXT AS sync_status,
    'pipeline_a'::TEXT AS pipeline_source
  FROM pipeline_a_agent_knowledge ak
  INNER JOIN pipeline_a_chunks_raw c ON c.id = ak.chunk_id
  INNER JOIN pipeline_a_documents d ON d.id = c.document_id
  WHERE ak.agent_id = p_agent_id AND ak.is_active = true
  GROUP BY d.id, d.file_name
  
  UNION ALL
  
  -- Pipeline B documents
  SELECT 
    d.id AS document_id,
    d.file_name AS document_name,
    COUNT(DISTINCT c.id) AS chunk_count,
    'completed'::TEXT AS sync_status,
    'pipeline_b'::TEXT AS pipeline_source
  FROM pipeline_b_agent_knowledge ak
  INNER JOIN pipeline_b_chunks_raw c ON c.id = ak.chunk_id
  INNER JOIN pipeline_b_documents d ON d.id = c.document_id
  WHERE ak.agent_id = p_agent_id AND ak.is_active = true
  GROUP BY d.id, d.file_name
  
  UNION ALL
  
  -- Pipeline C documents
  SELECT 
    d.id AS document_id,
    d.file_name AS document_name,
    COUNT(DISTINCT c.id) AS chunk_count,
    'completed'::TEXT AS sync_status,
    'pipeline_c'::TEXT AS pipeline_source
  FROM pipeline_c_agent_knowledge ak
  INNER JOIN pipeline_c_chunks_raw c ON c.id = ak.chunk_id
  INNER JOIN pipeline_c_documents d ON d.id = c.document_id
  WHERE ak.agent_id = p_agent_id AND ak.is_active = true
  GROUP BY d.id, d.file_name;
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
