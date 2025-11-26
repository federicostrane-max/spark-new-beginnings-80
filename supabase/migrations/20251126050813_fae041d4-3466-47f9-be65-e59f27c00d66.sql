-- ============================================
-- ELIMINAZIONE COMPLETA SISTEMA LEGACY
-- Mantiene solo Pipeline A, B, C
-- ============================================

-- Step 1: Drop tabelle legacy
DROP TABLE IF EXISTS agent_document_links CASCADE;
DROP TABLE IF EXISTS knowledge_documents CASCADE;
DROP TABLE IF EXISTS document_assignment_backups CASCADE;
DROP TABLE IF EXISTS document_processing_cache CASCADE;
DROP TABLE IF EXISTS document_processing_queue CASCADE;

-- Step 2: Pulire agent_knowledge da righe legacy
DELETE FROM agent_knowledge 
WHERE pool_document_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM pipeline_a_documents WHERE id = agent_knowledge.pool_document_id
  UNION
  SELECT 1 FROM pipeline_b_documents WHERE id = agent_knowledge.pool_document_id
  UNION
  SELECT 1 FROM pipeline_c_documents WHERE id = agent_knowledge.pool_document_id
);

-- Step 3: Rimuovere colonne legacy da agent_knowledge
ALTER TABLE agent_knowledge DROP COLUMN IF EXISTS source_type;

-- Step 4: DROP e ricreare RPC match_documents
DROP FUNCTION IF EXISTS match_documents(vector, uuid, double precision, integer);

CREATE FUNCTION match_documents(
  query_embedding vector(1536),
  p_agent_id uuid,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  content text,
  category text,
  similarity float,
  document_name text,
  chunk_type text,
  pipeline_source text
)
LANGUAGE plpgsql
AS $$
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
  
  -- Pipeline A chunks
  SELECT 
    par.id,
    par.content,
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
$$;

-- Step 5: DROP e ricreare RPC get_agent_sync_status
DROP FUNCTION IF EXISTS get_agent_sync_status(uuid);

CREATE FUNCTION get_agent_sync_status(p_agent_id uuid)
RETURNS TABLE (
  document_id uuid,
  document_name text,
  sync_status text,
  pipeline_source text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  -- Pipeline B documents
  SELECT DISTINCT
    pb.id as document_id,
    pb.file_name as document_name,
    'completed'::text as sync_status,
    'pipeline_b'::text as pipeline_source
  FROM pipeline_b_documents pb
  JOIN pipeline_b_chunks_raw pbcr ON pbcr.document_id = pb.id
  JOIN pipeline_b_agent_knowledge pbak ON pbak.chunk_id = pbcr.id
  WHERE pbak.agent_id = p_agent_id
    AND pbak.is_active = true
  
  UNION ALL
  
  -- Pipeline C documents
  SELECT DISTINCT
    pc.id as document_id,
    pc.file_name as document_name,
    'completed'::text as sync_status,
    'pipeline_c'::text as pipeline_source
  FROM pipeline_c_documents pc
  JOIN pipeline_c_chunks_raw pccr ON pccr.document_id = pc.id
  JOIN pipeline_c_agent_knowledge pcak ON pcak.chunk_id = pccr.id
  WHERE pcak.agent_id = p_agent_id
    AND pcak.is_active = true
  
  UNION ALL
  
  -- Pipeline A documents
  SELECT DISTINCT
    pa.id as document_id,
    pa.file_name as document_name,
    'completed'::text as sync_status,
    'pipeline_a'::text as pipeline_source
  FROM pipeline_a_documents pa
  JOIN pipeline_a_chunks_raw pacr ON pacr.document_id = pa.id
  JOIN pipeline_a_agent_knowledge paak ON paak.chunk_id = pacr.id
  WHERE paak.agent_id = p_agent_id
    AND paak.is_active = true;
END;
$$;