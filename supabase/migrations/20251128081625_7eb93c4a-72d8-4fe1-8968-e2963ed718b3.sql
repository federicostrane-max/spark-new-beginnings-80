-- Remove unique constraint on agent_conversations to allow multiple conversations per user+agent
-- This enables benchmark isolation where each test question gets its own conversation
ALTER TABLE agent_conversations 
DROP CONSTRAINT IF EXISTS agent_conversations_user_id_agent_id_key;