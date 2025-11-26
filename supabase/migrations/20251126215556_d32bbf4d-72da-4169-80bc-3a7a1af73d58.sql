-- Drop and recreate get_agent_sync_status RPC for Pipeline A, B, C
DROP FUNCTION IF EXISTS get_agent_sync_status(UUID);

CREATE OR REPLACE FUNCTION get_agent_sync_status(p_agent_id UUID)
RETURNS TABLE (
  document_id UUID,
  document_name TEXT,
  chunk_count BIGINT,
  sync_status TEXT,
  pipeline_source TEXT
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  -- Pipeline A
  SELECT 
    d.id AS document_id,
    d.file_name AS document_name,
    COUNT(c.id) AS chunk_count,
    'completed' AS sync_status,
    'pipeline_a' AS pipeline_source
  FROM pipeline_a_documents d
  JOIN pipeline_a_chunks_raw c ON c.document_id = d.id
  JOIN pipeline_a_agent_knowledge ak ON ak.chunk_id = c.id
  WHERE ak.agent_id = p_agent_id
    AND c.embedding_status = 'ready'
  GROUP BY d.id, d.file_name

  UNION ALL

  -- Pipeline B
  SELECT 
    d.id AS document_id,
    d.file_name AS document_name,
    COUNT(c.id) AS chunk_count,
    'completed' AS sync_status,
    'pipeline_b' AS pipeline_source
  FROM pipeline_b_documents d
  JOIN pipeline_b_chunks_raw c ON c.document_id = d.id
  JOIN pipeline_b_agent_knowledge ak ON ak.chunk_id = c.id
  WHERE ak.agent_id = p_agent_id
    AND c.embedding_status = 'ready'
  GROUP BY d.id, d.file_name

  UNION ALL

  -- Pipeline C
  SELECT 
    d.id AS document_id,
    d.file_name AS document_name,
    COUNT(c.id) AS chunk_count,
    'completed' AS sync_status,
    'pipeline_c' AS pipeline_source
  FROM pipeline_c_documents d
  JOIN pipeline_c_chunks_raw c ON c.document_id = d.id
  JOIN pipeline_c_agent_knowledge ak ON ak.chunk_id = c.id
  WHERE ak.agent_id = p_agent_id
    AND c.embedding_status = 'ready'
  GROUP BY d.id, d.file_name;
END;
$$;