-- Allow 'system' role in agent_messages table
-- This is needed for inter-agent consultation notifications

ALTER TABLE agent_messages 
DROP CONSTRAINT IF EXISTS agent_messages_role_check;

ALTER TABLE agent_messages 
ADD CONSTRAINT agent_messages_role_check 
CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]));