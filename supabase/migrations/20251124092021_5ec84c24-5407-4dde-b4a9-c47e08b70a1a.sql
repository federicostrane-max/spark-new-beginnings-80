-- Fix match_documents function to properly handle shared pool documents

CREATE OR REPLACE FUNCTION public.match_documents(
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
      -- Case 1: Direct upload documents (agent-specific)
      (
        (ak.source_type = 'direct_upload' OR ak.source_type IS NULL)
        AND (filter_agent_id IS NULL OR ak.agent_id = filter_agent_id)
      )
      OR
      -- Case 2: Shared pool documents (accessible via agent_document_links)
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
  ORDER BY ak.embedding <=> query_embedding
  LIMIT match_count;
$$;