
-- Function to get full message content without payload limits
CREATE OR REPLACE FUNCTION public.get_full_message_content(p_message_id UUID)
RETURNS TABLE(
  id UUID,
  conversation_id UUID,
  role TEXT,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  llm_provider TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    am.id,
    am.conversation_id,
    am.role,
    am.content,
    am.created_at,
    am.llm_provider
  FROM agent_messages am
  WHERE am.id = p_message_id;
END;
$$;
