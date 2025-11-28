-- Fix security warning: add search_path to keyword_search_documents function
CREATE OR REPLACE FUNCTION keyword_search_documents(
  search_query TEXT,
  p_agent_id UUID,
  match_count INTEGER DEFAULT 10
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  category TEXT,
  similarity DOUBLE PRECISION,
  document_name TEXT,
  chunk_type TEXT,
  pipeline_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  -- Pipeline A-Hybrid chunks with FTS
  SELECT 
    pah.id,
    CASE 
      WHEN pah.original_content IS NOT NULL THEN pah.original_content
      ELSE pah.content 
    END as content,
    pah.chunk_type::text as category,
    ts_rank(to_tsvector('english', pah.content), plainto_tsquery('english', search_query))::double precision as similarity,
    pahd.file_name as document_name,
    pah.chunk_type,
    'pipeline_a_hybrid'::text as pipeline_source
  FROM pipeline_a_hybrid_chunks_raw pah
  JOIN pipeline_a_hybrid_agent_knowledge pahak ON pahak.chunk_id = pah.id
  JOIN pipeline_a_hybrid_documents pahd ON pahd.id = pah.document_id
  WHERE pahak.agent_id = p_agent_id
    AND pahak.is_active = true
    AND pah.embedding_status = 'ready'
    AND to_tsvector('english', pah.content) @@ plainto_tsquery('english', search_query)
  
  UNION ALL
  
  -- Pipeline A chunks with FTS
  SELECT 
    par.id,
    CASE 
      WHEN par.original_content IS NOT NULL THEN par.original_content
      ELSE par.content 
    END as content,
    par.chunk_type::text as category,
    ts_rank(to_tsvector('english', par.content), plainto_tsquery('english', search_query))::double precision as similarity,
    pad.file_name as document_name,
    par.chunk_type,
    'pipeline_a'::text as pipeline_source
  FROM pipeline_a_chunks_raw par
  JOIN pipeline_a_agent_knowledge paak ON paak.chunk_id = par.id
  JOIN pipeline_a_documents pad ON pad.id = par.document_id
  WHERE paak.agent_id = p_agent_id
    AND paak.is_active = true
    AND par.embedding_status = 'ready'
    AND to_tsvector('english', par.content) @@ plainto_tsquery('english', search_query)
  
  UNION ALL
  
  -- Pipeline B chunks with FTS
  SELECT 
    pcr.id,
    pcr.content,
    pcr.chunk_type::text as category,
    ts_rank(to_tsvector('english', pcr.content), plainto_tsquery('english', search_query))::double precision as similarity,
    pd.file_name as document_name,
    pcr.chunk_type,
    'pipeline_b'::text as pipeline_source
  FROM pipeline_b_chunks_raw pcr
  JOIN pipeline_b_agent_knowledge pak ON pak.chunk_id = pcr.id
  JOIN pipeline_b_documents pd ON pd.id = pcr.document_id
  WHERE pak.agent_id = p_agent_id
    AND pak.is_active = true
    AND pcr.embedding_status = 'ready'
    AND to_tsvector('english', pcr.content) @@ plainto_tsquery('english', search_query)
  
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;