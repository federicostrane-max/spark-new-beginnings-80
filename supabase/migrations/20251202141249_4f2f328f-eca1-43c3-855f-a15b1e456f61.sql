
CREATE OR REPLACE FUNCTION public.get_unassigned_benchmark_documents()
 RETURNS TABLE(document_id uuid, file_name text, ready_chunks bigint, assigned_chunks bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    bd.document_id,
    bd.file_name,
    (SELECT COUNT(*) 
     FROM pipeline_a_hybrid_chunks_raw c 
     WHERE c.document_id = bd.document_id 
     AND c.embedding_status = 'ready') as ready_chunks,
    (SELECT COUNT(*) 
     FROM pipeline_a_hybrid_agent_knowledge ak 
     JOIN pipeline_a_hybrid_chunks_raw c ON ak.chunk_id = c.id 
     WHERE c.document_id = bd.document_id 
     AND ak.agent_id = 'bcca9289-0d7b-4e74-87f5-0f66ae93249c'::uuid) as assigned_chunks
  FROM benchmark_datasets bd
  WHERE bd.document_id IS NOT NULL
  AND (
    -- Has ready chunks
    (SELECT COUNT(*) 
     FROM pipeline_a_hybrid_chunks_raw c 
     WHERE c.document_id = bd.document_id 
     AND c.embedding_status = 'ready') > 0
  )
  AND (
    -- FIX: Assigned chunks less than ready chunks (catches partial assignments)
    (SELECT COUNT(*) 
     FROM pipeline_a_hybrid_agent_knowledge ak 
     JOIN pipeline_a_hybrid_chunks_raw c ON ak.chunk_id = c.id 
     WHERE c.document_id = bd.document_id 
     AND ak.agent_id = 'bcca9289-0d7b-4e74-87f5-0f66ae93249c'::uuid) < 
    (SELECT COUNT(*) 
     FROM pipeline_a_hybrid_chunks_raw c 
     WHERE c.document_id = bd.document_id 
     AND c.embedding_status = 'ready')
  );
END;
$function$;
