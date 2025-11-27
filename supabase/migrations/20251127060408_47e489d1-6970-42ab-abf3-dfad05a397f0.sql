-- Drop old RPC function
DROP FUNCTION IF EXISTS get_agent_sync_status(uuid);

-- Recreate RPC with only Pipeline A, B, C (no legacy)
CREATE OR REPLACE FUNCTION get_agent_sync_status(p_agent_id uuid)
RETURNS TABLE (
  document_id uuid,
  document_name text,
  sync_status text,
  chunk_count bigint,
  pipeline_source text
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  -- Pipeline A
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    CASE 
      WHEN COUNT(ak.chunk_id) > 0 THEN 'completed'
      ELSE 'pending'
    END as sync_status,
    COUNT(ak.chunk_id) as chunk_count,
    'pipeline_a'::text as pipeline_source
  FROM pipeline_a_documents d
  LEFT JOIN pipeline_a_agent_knowledge ak ON ak.agent_id = p_agent_id
  LEFT JOIN pipeline_a_chunks_raw c ON c.id = ak.chunk_id AND c.document_id = d.id
  WHERE d.status = 'ready'
  GROUP BY d.id, d.file_name
  
  UNION ALL
  
  -- Pipeline B
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    CASE 
      WHEN COUNT(ak.chunk_id) > 0 THEN 'completed'
      ELSE 'pending'
    END as sync_status,
    COUNT(ak.chunk_id) as chunk_count,
    'pipeline_b'::text as pipeline_source
  FROM pipeline_b_documents d
  LEFT JOIN pipeline_b_agent_knowledge ak ON ak.agent_id = p_agent_id
  LEFT JOIN pipeline_b_chunks_raw c ON c.id = ak.chunk_id AND c.document_id = d.id
  WHERE d.status = 'ready'
  GROUP BY d.id, d.file_name
  
  UNION ALL
  
  -- Pipeline C
  SELECT 
    d.id as document_id,
    d.file_name as document_name,
    CASE 
      WHEN COUNT(ak.chunk_id) > 0 THEN 'completed'
      ELSE 'pending'
    END as sync_status,
    COUNT(ak.chunk_id) as chunk_count,
    'pipeline_c'::text as pipeline_source
  FROM pipeline_c_documents d
  LEFT JOIN pipeline_c_agent_knowledge ak ON ak.agent_id = p_agent_id
  LEFT JOIN pipeline_c_chunks_raw c ON c.id = ak.chunk_id AND c.document_id = d.id
  WHERE d.status = 'ready'
  GROUP BY d.id, d.file_name;
END;
$$;