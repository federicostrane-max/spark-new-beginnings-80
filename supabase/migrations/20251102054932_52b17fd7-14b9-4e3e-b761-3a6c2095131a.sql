-- Add unique constraint to ensure one conversation per user-agent pair
ALTER TABLE agent_conversations 
ADD CONSTRAINT unique_user_agent_conversation 
UNIQUE (user_id, agent_id);

-- Function to get or create the unique conversation for a user-agent pair
CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_user_id TEXT,
  p_agent_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  -- Try to find existing conversation
  SELECT id INTO v_conversation_id
  FROM agent_conversations
  WHERE user_id = p_user_id AND agent_id = p_agent_id;
  
  -- If not found, create it
  IF v_conversation_id IS NULL THEN
    INSERT INTO agent_conversations (user_id, agent_id, title)
    VALUES (p_user_id, p_agent_id, 'Chat')
    RETURNING id INTO v_conversation_id;
  END IF;
  
  RETURN v_conversation_id;
END;
$$;

-- Optional: Clean up duplicate conversations (keep only the most recent per user-agent)
WITH ranked_conversations AS (
  SELECT 
    id,
    user_id,
    agent_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, agent_id 
      ORDER BY updated_at DESC
    ) as rn
  FROM agent_conversations
)
DELETE FROM agent_conversations
WHERE id IN (
  SELECT id FROM ranked_conversations WHERE rn > 1
);