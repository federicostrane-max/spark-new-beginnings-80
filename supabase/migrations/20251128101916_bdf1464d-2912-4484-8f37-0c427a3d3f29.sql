-- Assign all existing FinQA chunks to "pipiline C tester" agent (bcca9289-0d7b-4e74-87f5-0f66ae93249c)
INSERT INTO pipeline_a_hybrid_agent_knowledge (agent_id, chunk_id, is_active, synced_at)
SELECT 
  'bcca9289-0d7b-4e74-87f5-0f66ae93249c'::uuid as agent_id,
  c.id as chunk_id,
  true as is_active,
  now() as synced_at
FROM pipeline_a_hybrid_chunks_raw c
JOIN pipeline_a_hybrid_documents d ON d.id = c.document_id
WHERE d.file_name LIKE 'finqa_%'
  AND c.embedding_status = 'ready'
ON CONFLICT (agent_id, chunk_id) DO NOTHING;