-- Update match_documents RPC to support Small-to-Big Retrieval for ALL chunks
-- Remove is_atomic condition: ANY chunk with original_content returns parent context

CREATE OR REPLACE FUNCTION public.match_documents(
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
  
  -- Pipeline A chunks with Small-to-Big Retrieval
  -- ★ UPDATED: Return original_content when available (not just for atomic elements)
  SELECT 
    par.id,
    CASE 
      WHEN par.original_content IS NOT NULL 
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
  
  UNION ALL
  
  -- Pipeline A-Hybrid chunks with Small-to-Big Retrieval
  -- ★ UPDATED: Return original_content when available (not just for atomic elements)
  SELECT 
    pah.id,
    CASE 
      WHEN pah.original_content IS NOT NULL 
      THEN pah.original_content
      ELSE pah.content 
    END as content,
    pah.chunk_type::text as category,
    1 - (pah.embedding <=> query_embedding) as similarity,
    pahd.file_name as document_name,
    pah.chunk_type,
    'pipeline_a_hybrid'::text as pipeline_source
  FROM pipeline_a_hybrid_chunks_raw pah
  JOIN pipeline_a_hybrid_agent_knowledge pahak ON pahak.chunk_id = pah.id
  JOIN pipeline_a_hybrid_documents pahd ON pahd.id = pah.document_id
  WHERE pahak.agent_id = p_agent_id
    AND pahak.is_active = true
    AND pah.embedding_status = 'ready'
    AND 1 - (pah.embedding <=> query_embedding) > match_threshold
  
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$function$;