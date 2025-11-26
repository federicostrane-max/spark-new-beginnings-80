-- Drop and recreate get_agent_sync_status RPC to include Pipeline A

DROP FUNCTION IF EXISTS get_agent_sync_status(uuid);

CREATE FUNCTION get_agent_sync_status(p_agent_id UUID)
RETURNS TABLE (
  document_id UUID,
  document_name TEXT,
  sync_status TEXT,
  created_at TIMESTAMPTZ,
  pipeline_source TEXT
) AS $$
BEGIN
  RETURN QUERY
  -- Legacy knowledge_documents
  SELECT 
    kd.id AS document_id,
    kd.file_name AS document_name,
    COALESCE(adl.sync_status, 'unknown') AS sync_status,
    kd.created_at,
    'legacy'::TEXT AS pipeline_source
  FROM knowledge_documents kd
  LEFT JOIN agent_document_links adl ON adl.document_id = kd.id AND adl.agent_id = p_agent_id
  WHERE kd.id IN (
    SELECT document_id FROM agent_document_links WHERE agent_id = p_agent_id
  )
  
  UNION ALL
  
  -- Pipeline A documents
  SELECT
    pa.id AS document_id,
    pa.file_name AS document_name,
    CASE 
      WHEN pak.is_active THEN 'completed'
      ELSE 'pending'
    END AS sync_status,
    pa.created_at,
    'pipeline_a'::TEXT AS pipeline_source
  FROM pipeline_a_documents pa
  INNER JOIN pipeline_a_agent_knowledge pak ON pak.chunk_id IN (
    SELECT id FROM pipeline_a_chunks_raw WHERE document_id = pa.id
  )
  WHERE pak.agent_id = p_agent_id
  
  UNION ALL
  
  -- Pipeline B documents
  SELECT
    pb.id AS document_id,
    pb.file_name AS document_name,
    CASE 
      WHEN pbk.is_active THEN 'completed'
      ELSE 'pending'
    END AS sync_status,
    pb.created_at,
    'pipeline_b'::TEXT AS pipeline_source
  FROM pipeline_b_documents pb
  INNER JOIN pipeline_b_agent_knowledge pbk ON pbk.chunk_id IN (
    SELECT id FROM pipeline_b_chunks_raw WHERE document_id = pb.id
  )
  WHERE pbk.agent_id = p_agent_id
  
  UNION ALL
  
  -- Pipeline C documents
  SELECT
    pc.id AS document_id,
    pc.file_name AS document_name,
    CASE 
      WHEN pck.is_active THEN 'completed'
      ELSE 'pending'
    END AS sync_status,
    pc.created_at,
    'pipeline_c'::TEXT AS pipeline_source
  FROM pipeline_c_documents pc
  INNER JOIN pipeline_c_agent_knowledge pck ON pck.chunk_id IN (
    SELECT id FROM pipeline_c_chunks_raw WHERE document_id = pc.id
  )
  WHERE pck.agent_id = p_agent_id
  
  ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;