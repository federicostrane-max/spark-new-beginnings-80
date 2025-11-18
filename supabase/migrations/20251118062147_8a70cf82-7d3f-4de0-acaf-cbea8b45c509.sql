-- Fix immediato: Aggiorna tutti i 6 tipi di agente a GPT5 Nano
UPDATE alignment_agent_prompts
SET llm_model = 'openai/gpt-5-nano'
WHERE is_active = true
  AND agent_type IN ('general', 'narrative', 'procedural', 'research', 'technical', 'domain-expert');