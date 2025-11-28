-- Assign all benchmark chunks to pipiline C tester agent
INSERT INTO pipeline_a_hybrid_agent_knowledge (id, agent_id, chunk_id, is_active, synced_at)
SELECT 
  gen_random_uuid(),
  'bcca9289-0d7b-4e74-87f5-0f66ae93249c'::uuid,
  c.id,
  true,
  NOW()
FROM pipeline_a_hybrid_chunks_raw c
JOIN pipeline_a_hybrid_documents d ON d.id = c.document_id
WHERE d.folder LIKE 'benchmark_%'
  AND c.embedding_status = 'ready'
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_a_hybrid_agent_knowledge ak 
    WHERE ak.chunk_id = c.id 
    AND ak.agent_id = 'bcca9289-0d7b-4e74-87f5-0f66ae93249c'::uuid
  );