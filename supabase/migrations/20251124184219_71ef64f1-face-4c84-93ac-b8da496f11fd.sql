-- Fix get_agent_sync_status to properly group Pipeline B documents
DROP FUNCTION IF EXISTS public.get_agent_sync_status(uuid);

CREATE OR REPLACE FUNCTION public.get_agent_sync_status(p_agent_id uuid)
RETURNS TABLE(
  document_id uuid, 
  file_name text, 
  chunk_count bigint, 
  sync_status text,
  pipeline_source text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  -- Legacy pipeline documents
  SELECT 
    adl.document_id,
    kd.file_name,
    COUNT(ak.id) as chunk_count,
    adl.sync_status,
    'legacy'::text as pipeline_source
  FROM agent_document_links adl
  LEFT JOIN knowledge_documents kd ON kd.id = adl.document_id
  LEFT JOIN agent_knowledge ak ON ak.pool_document_id = adl.document_id 
    AND ak.agent_id IS NULL 
    AND ak.is_active = true
  WHERE adl.agent_id = p_agent_id
  GROUP BY adl.document_id, kd.file_name, adl.sync_status

  UNION ALL

  -- Pipeline B documents (group by document, not chunk)
  SELECT 
    pbd.id as document_id,
    pbd.file_name,
    COUNT(DISTINCT pbak.chunk_id) as chunk_count,
    CASE 
      WHEN COUNT(pbak.chunk_id) > 0 THEN 'completed'::text
      ELSE 'pending'::text
    END as sync_status,
    'pipeline_b'::text as pipeline_source
  FROM pipeline_b_documents pbd
  LEFT JOIN pipeline_b_chunks_raw pbcr ON pbcr.document_id = pbd.id
  LEFT JOIN pipeline_b_agent_knowledge pbak ON pbak.chunk_id = pbcr.id 
    AND pbak.agent_id = p_agent_id
    AND pbak.is_active = true
  WHERE pbd.status = 'ready'
    AND EXISTS (
      SELECT 1 FROM pipeline_b_agent_knowledge pbak2
      JOIN pipeline_b_chunks_raw pbcr2 ON pbcr2.id = pbak2.chunk_id
      WHERE pbcr2.document_id = pbd.id
        AND pbak2.agent_id = p_agent_id
    )
  GROUP BY pbd.id, pbd.file_name;
END;
$$;