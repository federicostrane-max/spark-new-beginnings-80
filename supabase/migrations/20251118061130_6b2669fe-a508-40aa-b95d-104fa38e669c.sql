-- Fix immediato: Sincronizza Claude Sonnet 4.5 su tutti i 6 tipi di agente
-- Questo risolve la situazione attuale mentre aspettiamo il deployment corretto dell'edge function

UPDATE alignment_agent_prompts
SET llm_model = 'claude-sonnet-4-5'
WHERE is_active = true
  AND agent_type IN ('general', 'narrative', 'procedural', 'research', 'technical', 'domain-expert')
  AND (llm_model IS NULL OR llm_model != 'claude-sonnet-4-5');