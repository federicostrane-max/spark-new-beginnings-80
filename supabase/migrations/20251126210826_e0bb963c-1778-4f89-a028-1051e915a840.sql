
-- Drop and recreate the get_agent_sync_status function with simplified, efficient query
DROP FUNCTION IF EXISTS public.get_agent_sync_status(uuid);

CREATE OR REPLACE FUNCTION public.get_agent_sync_status(p_agent_id uuid)
RETURNS TABLE(document_id uuid, document_name text, sync_status text, pipeline_source text, chunk_count bigint)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  -- Single UNION query with optimized structure and global limit
  SELECT * FROM (
    -- Pipeline A documents
    SELECT DISTINCT
      pa.id as document_id,
      pa.file_name as document_name,
      'completed'::text as sync_status,
      'pipeline_a'::text as pipeline_source,
      (
        SELECT COUNT(*)::bigint
        FROM pipeline_a_agent_knowledge paak_inner
        JOIN pipeline_a_chunks_raw pacr_inner ON pacr_inner.id = paak_inner.chunk_id
        WHERE paak_inner.agent_id = p_agent_id
          AND paak_inner.is_active = true
          AND pacr_inner.document_id = pa.id
      ) as chunk_count
    FROM pipeline_a_documents pa
    WHERE EXISTS (
      SELECT 1
      FROM pipeline_a_agent_knowledge paak
      JOIN pipeline_a_chunks_raw pacr ON pacr.id = paak.chunk_id
      WHERE paak.agent_id = p_agent_id
        AND paak.is_active = true
        AND pacr.document_id = pa.id
    )
    
    UNION ALL
    
    -- Pipeline B documents
    SELECT DISTINCT
      pb.id as document_id,
      pb.file_name as document_name,
      'completed'::text as sync_status,
      'pipeline_b'::text as pipeline_source,
      (
        SELECT COUNT(*)::bigint
        FROM pipeline_b_agent_knowledge pbak_inner
        JOIN pipeline_b_chunks_raw pbcr_inner ON pbcr_inner.id = pbak_inner.chunk_id
        WHERE pbak_inner.agent_id = p_agent_id
          AND pbak_inner.is_active = true
          AND pbcr_inner.document_id = pb.id
      ) as chunk_count
    FROM pipeline_b_documents pb
    WHERE EXISTS (
      SELECT 1
      FROM pipeline_b_agent_knowledge pbak
      JOIN pipeline_b_chunks_raw pbcr ON pbcr.id = pbak.chunk_id
      WHERE pbak.agent_id = p_agent_id
        AND pbak.is_active = true
        AND pbcr.document_id = pb.id
    )
    
    UNION ALL
    
    -- Pipeline C documents
    SELECT DISTINCT
      pc.id as document_id,
      pc.file_name as document_name,
      'completed'::text as sync_status,
      'pipeline_c'::text as pipeline_source,
      (
        SELECT COUNT(*)::bigint
        FROM pipeline_c_agent_knowledge pcak_inner
        JOIN pipeline_c_chunks_raw pccr_inner ON pccr_inner.id = pcak_inner.chunk_id
        WHERE pcak_inner.agent_id = p_agent_id
          AND pcak_inner.is_active = true
          AND pccr_inner.document_id = pc.id
      ) as chunk_count
    FROM pipeline_c_documents pc
    WHERE EXISTS (
      SELECT 1
      FROM pipeline_c_agent_knowledge pcak
      JOIN pipeline_c_chunks_raw pccr ON pccr.id = pcak.chunk_id
      WHERE pcak.agent_id = p_agent_id
        AND pcak.is_active = true
        AND pccr.document_id = pc.id
    )
  ) all_docs
  LIMIT 300;  -- Global limit to prevent timeout with many documents
END;
$$;

-- Add helpful comment
COMMENT ON FUNCTION public.get_agent_sync_status(uuid) IS 
'Optimized RPC to fetch agent document sync status across all 3 pipelines (A, B, C). Uses EXISTS for efficient filtering and scalar subqueries for chunk counts. Limited to 300 total documents to prevent timeouts.';
