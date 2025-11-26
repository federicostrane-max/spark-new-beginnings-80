-- Update match_documents RPC to include recursive retrieval for Pipeline A
-- This ensures Pipeline A returns original_content for atomic chunks (tables, code blocks)
-- instead of summaries, preventing LLM hallucination from incomplete context

DROP FUNCTION IF EXISTS public.match_documents(vector, uuid, double precision, integer);

CREATE FUNCTION public.match_documents(
  query_embedding vector, 
  p_agent_id uuid, 
  match_threshold double precision DEFAULT 0.5, 
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  id uuid, 
  content text, 
  category text, 
  similarity double precision, 
  document_name text, 
  chunk_type text, 
  pipeline_source text
)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  -- Pipeline B chunks
  SELECT 
    pcr.id,
    pcr.content,
    pcr.chunk_type::text as category,
    1 - (pcr.embedding <=> query_embedding) as similarity,
    pd.file_name as document_name,
    pcr.chunk_type,
    'pipeline_b'::text as pipeline_source
  FROM pipeline_b_chunks_raw pcr
  JOIN pipeline_b_agent_knowledge pak ON pak.chunk_id = pcr.id
  JOIN pipeline_b_documents pd ON pd.id = pcr.document_id
  WHERE pak.agent_id = p_agent_id
    AND pak.is_active = true
    AND pcr.embedding_status = 'ready'
    AND 1 - (pcr.embedding <=> query_embedding) > match_threshold
  
  UNION ALL
  
  -- Pipeline C chunks
  SELECT 
    pcr.id,
    pcr.content,
    pcr.chunk_type::text as category,
    1 - (pcr.embedding <=> query_embedding) as similarity,
    pd.file_name as document_name,
    pcr.chunk_type,
    'pipeline_c'::text as pipeline_source
  FROM pipeline_c_chunks_raw pcr
  JOIN pipeline_c_agent_knowledge pak ON pak.chunk_id = pcr.id
  JOIN pipeline_c_documents pd ON pd.id = pcr.document_id
  WHERE pak.agent_id = p_agent_id
    AND pak.is_active = true
    AND pcr.embedding_status = 'ready'
    AND 1 - (pcr.embedding <=> query_embedding) > match_threshold
  
  UNION ALL
  
  -- Pipeline A chunks with recursive retrieval
  SELECT 
    par.id,
    CASE 
      WHEN par.is_atomic = true AND par.original_content IS NOT NULL 
      THEN par.original_content
      ELSE par.content 
    END as content,
    par.chunk_type::text as category,
    1 - (par.embedding <=> query_embedding) as similarity,
    pad.file_name as document_name,
    par.chunk_type,
    'pipeline_a'::text as pipeline_source
  FROM pipeline_a_chunks_raw par
  JOIN pipeline_a_agent_knowledge paak ON paak.chunk_id = par.id
  JOIN pipeline_a_documents pad ON pad.id = par.document_id
  WHERE paak.agent_id = p_agent_id
    AND paak.is_active = true
    AND par.embedding_status = 'ready'
    AND 1 - (par.embedding <=> query_embedding) > match_threshold
  
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$function$;