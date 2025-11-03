-- Drop the old match_documents function
DROP FUNCTION IF EXISTS public.match_documents(vector, uuid, double precision, integer);

-- Create new match_documents function that respects pool assignments
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  filter_agent_id uuid DEFAULT NULL,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  document_name text,
  content text,
  category text,
  summary text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  WITH agent_documents AS (
    SELECT 
      ak.id,
      ak.document_name,
      ak.content,
      ak.category,
      ak.summary,
      ak.embedding,
      ak.source_type,
      ak.pool_document_id,
      ak.agent_id
    FROM agent_knowledge ak
    WHERE ak.embedding IS NOT NULL
      AND (filter_agent_id IS NULL OR ak.agent_id = filter_agent_id)
  )
  SELECT
    ad.id,
    ad.document_name,
    ad.content,
    ad.category,
    ad.summary,
    1 - (ad.embedding <=> query_embedding) AS similarity
  FROM agent_documents ad
  WHERE 
    -- For pool documents, check if assigned via agent_document_links
    (ad.source_type = 'pool' AND ad.pool_document_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM agent_document_links adl
      WHERE adl.document_id = ad.pool_document_id 
        AND adl.agent_id = ad.agent_id
    ))
    -- For direct uploads, just use agent_id filter
    OR (ad.source_type = 'direct_upload' OR ad.source_type IS NULL)
  AND 1 - (ad.embedding <=> query_embedding) > match_threshold
  ORDER BY ad.embedding <=> query_embedding
  LIMIT match_count;
$$;