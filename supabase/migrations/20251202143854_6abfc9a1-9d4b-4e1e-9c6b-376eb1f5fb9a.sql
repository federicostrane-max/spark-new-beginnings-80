-- RPC per trovare documenti "zombie" con tutti i batch completati ma status non finale
CREATE OR REPLACE FUNCTION public.find_zombie_documents_for_aggregation()
RETURNS TABLE(document_id uuid, file_name text, total_batches bigint, completed_batches bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    d.id as document_id,
    d.file_name,
    COUNT(pj.id) as total_batches,
    SUM(CASE WHEN pj.status = 'completed' THEN 1 ELSE 0 END) as completed_batches
  FROM pipeline_a_hybrid_documents d
  INNER JOIN processing_jobs pj ON pj.document_id = d.id
  WHERE d.status NOT IN ('ready', 'failed', 'partial_failure', 'chunked')
  GROUP BY d.id, d.file_name
  HAVING 
    SUM(CASE WHEN pj.status = 'completed' THEN 1 ELSE 0 END) = COUNT(pj.id)
    AND COUNT(pj.id) > 0;
END;
$function$;