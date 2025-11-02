-- Create function to get distinct documents efficiently
CREATE OR REPLACE FUNCTION get_distinct_documents(p_agent_id UUID)
RETURNS TABLE (
  id UUID,
  document_name TEXT,
  category TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (ak.document_name)
    ak.id,
    ak.document_name,
    ak.category,
    ak.summary,
    ak.created_at
  FROM agent_knowledge ak
  WHERE ak.agent_id = p_agent_id
  ORDER BY ak.document_name, ak.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;