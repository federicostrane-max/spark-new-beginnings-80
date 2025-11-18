-- Fix: Aggiorna immediatamente i 4 tipi non sincronizzati con Claude Sonnet 4.5
-- Questo corregge i tipi che non sono stati aggiornati durante il salvataggio globale

UPDATE alignment_agent_prompts
SET llm_model = 'claude-sonnet-4-5'
WHERE is_active = true
  AND agent_type IN ('narrative', 'procedural', 'research', 'technical')
  AND (llm_model IS NULL OR llm_model != 'claude-sonnet-4-5');