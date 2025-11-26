-- Drop and recreate get_agent_sync_status RPC with chunk_count
-- This fixes the UI showing "Non sincronizzato (0 chunks)" for Pipeline A/B/C documents

DROP FUNCTION IF EXISTS public.get_agent_sync_status(uuid);

CREATE FUNCTION public.get_agent_sync_status(p_agent_id uuid)
 RETURNS TABLE(document_id uuid, document_name text, sync_status text, pipeline_source text, chunk_count bigint)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  -- Pipeline B documents with chunk count
  SELECT 
    pb.id as document_id,
    pb.file_name as document_name,
    'completed'::text as sync_status,
    'pipeline_b'::text as pipeline_source,
    COUNT(pbak.chunk_id)::bigint as chunk_count
  FROM pipeline_b_documents pb
  JOIN pipeline_b_chunks_raw pbcr ON pbcr.document_id = pb.id
  JOIN pipeline_b_agent_knowledge pbak ON pbak.chunk_id = pbcr.id
  WHERE pbak.agent_id = p_agent_id
    AND pbak.is_active = true
  GROUP BY pb.id, pb.file_name
  
  UNION ALL
  
  -- Pipeline C documents with chunk count
  SELECT 
    pc.id as document_id,
    pc.file_name as document_name,
    'completed'::text as sync_status,
    'pipeline_c'::text as pipeline_source,
    COUNT(pcak.chunk_id)::bigint as chunk_count
  FROM pipeline_c_documents pc
  JOIN pipeline_c_chunks_raw pccr ON pccr.document_id = pc.id
  JOIN pipeline_c_agent_knowledge pcak ON pcak.chunk_id = pccr.id
  WHERE pcak.agent_id = p_agent_id
    AND pcak.is_active = true
  GROUP BY pc.id, pc.file_name
  
  UNION ALL
  
  -- Pipeline A documents with chunk count
  SELECT 
    pa.id as document_id,
    pa.file_name as document_name,
    'completed'::text as sync_status,
    'pipeline_a'::text as pipeline_source,
    COUNT(paak.chunk_id)::bigint as chunk_count
  FROM pipeline_a_documents pa
  JOIN pipeline_a_chunks_raw pacr ON pacr.document_id = pa.id
  JOIN pipeline_a_agent_knowledge paak ON paak.chunk_id = pacr.id
  WHERE paak.agent_id = p_agent_id
    AND paak.is_active = true
  GROUP BY pa.id, pa.file_name;
END;
$function$;