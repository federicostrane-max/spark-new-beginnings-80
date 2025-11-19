-- Fix: Disambiguare column reference in consolidate_pool_chunks
DROP FUNCTION IF EXISTS consolidate_pool_chunks();

CREATE OR REPLACE FUNCTION consolidate_pool_chunks()
RETURNS TABLE(
  document_id UUID,
  document_name TEXT,
  chunks_before INT,
  chunks_after INT,
  duplicates_removed INT
) 
LANGUAGE plpgsql
AS $$
DECLARE
  doc_record RECORD;
  v_chunks_before INT;
  v_chunks_after INT;
  v_shared_exists BOOLEAN;
  v_doc_id UUID;
  v_doc_name TEXT;
BEGIN
  FOR doc_record IN 
    SELECT DISTINCT ak.pool_document_id, ak.document_name
    FROM agent_knowledge ak
    WHERE ak.pool_document_id IS NOT NULL
  LOOP
    v_doc_id := doc_record.pool_document_id;
    v_doc_name := doc_record.document_name;
    
    SELECT COUNT(*) INTO v_chunks_before
    FROM agent_knowledge
    WHERE pool_document_id = v_doc_id;
    
    SELECT EXISTS (
      SELECT 1 FROM agent_knowledge 
      WHERE pool_document_id = v_doc_id AND agent_id IS NULL
      LIMIT 1
    ) INTO v_shared_exists;
    
    IF NOT v_shared_exists THEN
      INSERT INTO agent_knowledge (
        agent_id, 
        pool_document_id, 
        document_name, 
        content, 
        category, 
        summary, 
        embedding, 
        source_type, 
        chunking_metadata,
        is_active,
        created_at
      )
      SELECT 
        NULL as agent_id,
        ak.pool_document_id,
        ak.document_name,
        ak.content,
        ak.category,
        ak.summary,
        ak.embedding,
        'shared_pool' as source_type,
        ak.chunking_metadata,
        ak.is_active,
        ak.created_at
      FROM agent_knowledge ak
      WHERE ak.pool_document_id = v_doc_id 
        AND ak.agent_id IS NOT NULL
      ORDER BY ak.created_at ASC;
    END IF;
    
    DELETE FROM agent_knowledge
    WHERE pool_document_id = v_doc_id AND agent_id IS NOT NULL;
    
    SELECT COUNT(*) INTO v_chunks_after
    FROM agent_knowledge
    WHERE pool_document_id = v_doc_id;
    
    document_id := v_doc_id;
    document_name := v_doc_name;
    chunks_before := v_chunks_before;
    chunks_after := v_chunks_after;
    duplicates_removed := v_chunks_before - v_chunks_after;
    
    RETURN NEXT;
  END LOOP;
END;
$$;