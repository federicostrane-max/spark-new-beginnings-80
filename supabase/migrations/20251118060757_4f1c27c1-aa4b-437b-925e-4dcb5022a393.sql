-- Fix definitivo: Aggiorna tutti i 6 tipi di agente con GPT5 Nano
-- Questo risolve il problema di sincronizzazione dove solo domain-expert aveva il modello corretto

UPDATE alignment_agent_prompts
SET llm_model = 'openai/gpt-5-nano'
WHERE is_active = true
  AND agent_type IN ('general', 'narrative', 'procedural', 'research', 'technical', 'domain-expert')
  AND (llm_model IS NULL OR llm_model != 'openai/gpt-5-nano');