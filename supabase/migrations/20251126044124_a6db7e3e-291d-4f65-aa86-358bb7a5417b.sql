-- Add Pipeline A to match_documents RPC with Recursive Retrieval
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector,
  filter_agent_id uuid DEFAULT NULL,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  pool_document_id uuid,
  document_name text,
  content text,
  category text,
  summary text,
  similarity double precision
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Legacy pipeline (agent_knowledge)
  SELECT
    ak.id,
    ak.pool_document_id,
    ak.document_name,
    ak.content,
    ak.category,
    ak.summary,
    1 - (ak.embedding <=> query_embedding) AS similarity
  FROM agent_knowledge ak
  WHERE ak.embedding IS NOT NULL
    AND ak.is_active = true
    AND 1 - (ak.embedding <=> query_embedding) > match_threshold
    AND (
      (
        (ak.source_type = 'direct_upload' OR ak.source_type IS NULL)
        AND (filter_agent_id IS NULL OR ak.agent_id = filter_agent_id)
      )
      OR
      (
        (ak.source_type = 'pool' OR ak.source_type = 'shared_pool')
        AND ak.pool_document_id IS NOT NULL
        AND ak.agent_id IS NULL
        AND (
          filter_agent_id IS NULL 
          OR EXISTS (
            SELECT 1 
            FROM agent_document_links adl
            WHERE adl.document_id = ak.pool_document_id 
              AND adl.agent_id = filter_agent_id
              AND adl.sync_status = 'completed'
          )
        )
      )
    )
  
  UNION ALL
  
  -- Pipeline B
  SELECT 
    pbcr.id,
    pbcr.document_id AS pool_document_id,
    pbd.file_name AS document_name,
    pbcr.content,
    pbcr.chunk_type AS category,
    NULL::text AS summary,
    1 - (pbcr.embedding <=> query_embedding) AS similarity
  FROM pipeline_b_chunks_raw pbcr
  JOIN pipeline_b_agent_knowledge pbak ON pbak.chunk_id = pbcr.id
  JOIN pipeline_b_documents pbd ON pbd.id = pbcr.document_id
  WHERE pbcr.embedding IS NOT NULL
    AND pbcr.embedding_status = 'ready'
    AND pbak.is_active = true
    AND 1 - (pbcr.embedding <=> query_embedding) > match_threshold
    AND (filter_agent_id IS NULL OR pbak.agent_id = filter_agent_id)
  
  UNION ALL
  
  -- Pipeline C
  SELECT 
    pccr.id,
    pccr.document_id AS pool_document_id,
    pcd.file_name AS document_name,
    pccr.content,
    pccr.chunk_type AS category,
    NULL::text AS summary,
    1 - (pccr.embedding <=> query_embedding) AS similarity
  FROM pipeline_c_chunks_raw pccr
  JOIN pipeline_c_agent_knowledge pcak ON pcak.chunk_id = pccr.id
  JOIN pipeline_c_documents pcd ON pcd.id = pccr.document_id
  WHERE pccr.embedding IS NOT NULL
    AND pccr.embedding_status = 'ready'
    AND pcak.is_active = true
    AND 1 - (pccr.embedding <=> query_embedding) > match_threshold
    AND (filter_agent_id IS NULL OR pcak.agent_id = filter_agent_id)
  
  UNION ALL
  
  -- Pipeline A with RECURSIVE RETRIEVAL
  SELECT 
    pacr.id,
    pacr.document_id AS pool_document_id,
    pad.file_name AS document_name,
    CASE 
      WHEN pacr.is_atomic AND pacr.original_content IS NOT NULL 
      THEN pacr.original_content
      ELSE pacr.content
    END as content,
    pacr.chunk_type AS category,
    pacr.summary,
    1 - (pacr.embedding <=> query_embedding) AS similarity
  FROM pipeline_a_chunks_raw pacr
  JOIN pipeline_a_agent_knowledge paak ON paak.chunk_id = pacr.id
  JOIN pipeline_a_documents pad ON pad.id = pacr.document_id
  WHERE pacr.embedding IS NOT NULL
    AND pacr.embedding_status = 'ready'
    AND paak.is_active = true
    AND 1 - (pacr.embedding <=> query_embedding) > match_threshold
    AND (filter_agent_id IS NULL OR paak.agent_id = filter_agent_id)
  
  ORDER BY similarity DESC
  LIMIT match_count;
$$;