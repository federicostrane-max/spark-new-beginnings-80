-- Add UPDATE policy for agent_messages to allow users to see updates via Realtime
-- This is needed for background processing updates
CREATE POLICY "Users can view updates to messages in their conversations"
ON agent_messages
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM agent_conversations c
    WHERE c.id = agent_messages.conversation_id
    AND c.user_id = auth.uid()::text
  )
);