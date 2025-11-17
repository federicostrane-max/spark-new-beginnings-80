-- Fix naming inconsistency: domain_expert -> domain-expert for v3 and v4
UPDATE alignment_agent_prompts 
SET agent_type = 'domain-expert'
WHERE agent_type = 'domain_expert' 
  AND version_number IN (3, 4);