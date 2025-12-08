
-- Fix keyword_search_documents to search BOTH content AND original_content
-- This ensures keyword search can find terms in the actual data, not just summaries
CREATE OR REPLACE FUNCTION keyword_search_documents(
  search_query text,
  p_agent_id uuid,
  match_count int DEFAULT 10,
  p_document_name text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  category text,
  similarity double precision,
  document_name text,
  chunk_type text,
  pipeline_source text
)
LANGUAGE plpgsql
AS $$
DECLARE
  or_query text;
BEGIN
  -- Convert space-separated terms to OR logic for permissive matching
  or_query := regexp_replace(trim(search_query), '\s+', ' | ', 'g');
  
  RETURN QUERY
  -- Pipeline A-Hybrid chunks with FTS on BOTH content AND original_content
  SELECT 
    pah.id,
    CASE 
      WHEN pah.original_content IS NOT NULL THEN pah.original_content
      ELSE pah.content 
    END as content,
    pah.chunk_type::text as category,
    -- Search ranking: check both content and original_content
    GREATEST(
      ts_rank(to_tsvector('english', pah.content), to_tsquery('english', or_query)),
      COALESCE(ts_rank(to_tsvector('english', pah.original_content), to_tsquery('english', or_query)), 0)
    )::double precision as similarity,
    pahd.file_name as document_name,
    pah.chunk_type,
    'pipeline_a_hybrid'::text as pipeline_source
  FROM pipeline_a_hybrid_chunks_raw pah
  JOIN pipeline_a_hybrid_agent_knowledge pahak ON pahak.chunk_id = pah.id
  JOIN pipeline_a_hybrid_documents pahd ON pahd.id = pah.document_id
  WHERE pahak.agent_id = p_agent_id
    AND pahak.is_active = true
    AND pah.embedding_status = 'ready'
    -- Match on EITHER content OR original_content
    AND (
      to_tsvector('english', pah.content) @@ to_tsquery('english', or_query)
      OR to_tsvector('english', COALESCE(pah.original_content, '')) @@ to_tsquery('english', or_query)
    )
    AND (p_document_name IS NULL OR pahd.file_name = p_document_name)
  
  UNION ALL
  
  -- Pipeline A chunks with FTS on BOTH content AND original_content
  SELECT 
    par.id,
    CASE 
      WHEN par.original_content IS NOT NULL THEN par.original_content
      ELSE par.content 
    END as content,
    par.chunk_type::text as category,
    GREATEST(
      ts_rank(to_tsvector('english', par.content), to_tsquery('english', or_query)),
      COALESCE(ts_rank(to_tsvector('english', par.original_content), to_tsquery('english', or_query)), 0)
    )::double precision as similarity,
    pad.file_name as document_name,
    par.chunk_type,
    'pipeline_a'::text as pipeline_source
  FROM pipeline_a_chunks_raw par
  JOIN pipeline_a_agent_knowledge paak ON paak.chunk_id = par.id
  JOIN pipeline_a_documents pad ON pad.id = par.document_id
  WHERE paak.agent_id = p_agent_id
    AND paak.is_active = true
    AND par.embedding_status = 'ready'
    AND (
      to_tsvector('english', par.content) @@ to_tsquery('english', or_query)
      OR to_tsvector('english', COALESCE(par.original_content, '')) @@ to_tsquery('english', or_query)
    )
    AND (p_document_name IS NULL OR pad.file_name = p_document_name)
  
  UNION ALL
  
  -- Pipeline B chunks with FTS (no original_content in this pipeline)
  SELECT 
    pcr.id,
    pcr.content,
    pcr.chunk_type::text as category,
    ts_rank(to_tsvector('english', pcr.content), to_tsquery('english', or_query))::double precision as similarity,
    pd.file_name as document_name,
    pcr.chunk_type,
    'pipeline_b'::text as pipeline_source
  FROM pipeline_b_chunks_raw pcr
  JOIN pipeline_b_agent_knowledge pak ON pak.chunk_id = pcr.id
  JOIN pipeline_b_documents pd ON pd.id = pcr.document_id
  WHERE pak.agent_id = p_agent_id
    AND pak.is_active = true
    AND pcr.embedding_status = 'ready'
    AND to_tsvector('english', pcr.content) @@ to_tsquery('english', or_query)
    AND (p_document_name IS NULL OR pd.file_name = p_document_name)
  
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
