-- Drop and recreate optimized version of consolidate_pool_chunks_batch
DROP FUNCTION IF EXISTS public.consolidate_pool_chunks_batch(integer);

CREATE OR REPLACE FUNCTION public.consolidate_pool_chunks_batch(batch_limit integer DEFAULT 10)
RETURNS TABLE(
  document_id uuid,
  document_name text,
  chunks_before integer,
  chunks_after integer,
  duplicates_removed integer
)
LANGUAGE plpgsql
AS $function$
DECLARE
  doc_record RECORD;
  v_chunks_before INT;
  v_chunks_after INT;
BEGIN
  -- Process documents in batch
  FOR doc_record IN 
    SELECT DISTINCT ak.pool_document_id, ak.document_name
    FROM agent_knowledge ak
    WHERE ak.pool_document_id IS NOT NULL
      AND ak.agent_id IS NOT NULL  -- Only documents that need consolidation
    LIMIT batch_limit
  LOOP
    -- Count chunks before
    SELECT COUNT(*) INTO v_chunks_before
    FROM agent_knowledge
    WHERE pool_document_id = doc_record.pool_document_id;
    
    -- Insert shared pool entries if they don't exist (UPSERT-like approach)
    -- This is much faster than checking existence first
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
      MIN(ak.created_at) as created_at  -- Use earliest timestamp
    FROM agent_knowledge ak
    WHERE ak.pool_document_id = doc_record.pool_document_id 
      AND ak.agent_id IS NOT NULL
    GROUP BY 
      ak.pool_document_id,
      ak.document_name,
      ak.content,
      ak.category,
      ak.summary,
      ak.embedding,
      ak.chunking_metadata,
      ak.is_active
    ON CONFLICT DO NOTHING;  -- Skip if already exists
    
    -- Delete agent-specific duplicates in a single operation
    DELETE FROM agent_knowledge
    WHERE pool_document_id = doc_record.pool_document_id 
      AND agent_id IS NOT NULL;
    
    -- Count chunks after
    SELECT COUNT(*) INTO v_chunks_after
    FROM agent_knowledge
    WHERE pool_document_id = doc_record.pool_document_id;
    
    -- Return result
    document_id := doc_record.pool_document_id;
    document_name := doc_record.document_name;
    chunks_before := v_chunks_before;
    chunks_after := v_chunks_after;
    duplicates_removed := v_chunks_before - v_chunks_after;
    
    RETURN NEXT;
  END LOOP;
END;
$function$;