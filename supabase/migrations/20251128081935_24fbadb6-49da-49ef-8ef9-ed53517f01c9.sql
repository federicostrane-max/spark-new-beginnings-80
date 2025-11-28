-- Remove the actual unique constraint on agent_conversations
-- This enables benchmark isolation where each test question gets its own conversation
ALTER TABLE agent_conversations 
DROP CONSTRAINT unique_user_agent_conversation;