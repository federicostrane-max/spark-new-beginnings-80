-- FASE 2: Funzione di consolidamento chunks
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
BEGIN
  -- Per ogni documento del pool
  FOR doc_record IN 
    SELECT DISTINCT ak.pool_document_id, ak.document_name
    FROM agent_knowledge ak
    WHERE ak.pool_document_id IS NOT NULL
  LOOP
    document_id := doc_record.pool_document_id;
    document_name := doc_record.document_name;
    
    -- Conta chunks prima del consolidamento
    SELECT COUNT(*) INTO v_chunks_before
    FROM agent_knowledge
    WHERE pool_document_id = document_id;
    
    -- Verifica se esistono già chunks condivisi (agent_id = NULL)
    SELECT EXISTS (
      SELECT 1 FROM agent_knowledge 
      WHERE pool_document_id = document_id AND agent_id IS NULL
      LIMIT 1
    ) INTO v_shared_exists;
    
    -- Se non esistono chunks condivisi, crea dal primo agent disponibile
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
        NULL as agent_id, -- SHARED POOL
        pool_document_id,
        document_name,
        content,
        category,
        summary,
        embedding,
        'shared_pool' as source_type,
        chunking_metadata,
        is_active,
        created_at
      FROM agent_knowledge
      WHERE pool_document_id = document_id 
        AND agent_id IS NOT NULL
      ORDER BY created_at ASC
      LIMIT (SELECT COUNT(*) FROM agent_knowledge WHERE pool_document_id = document_id AND agent_id IS NOT NULL LIMIT 1);
    END IF;
    
    -- Elimina TUTTI i duplicati agent-specific (mantieni solo agent_id = NULL)
    DELETE FROM agent_knowledge
    WHERE pool_document_id = document_id AND agent_id IS NOT NULL;
    
    -- Conta chunks dopo il consolidamento
    SELECT COUNT(*) INTO v_chunks_after
    FROM agent_knowledge
    WHERE pool_document_id = document_id;
    
    chunks_before := v_chunks_before;
    chunks_after := v_chunks_after;
    duplicates_removed := v_chunks_before - v_chunks_after;
    
    RETURN NEXT;
  END LOOP;
END;
$$;