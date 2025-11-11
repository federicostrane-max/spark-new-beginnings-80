-- Fix RLS policies on agent_knowledge to allow reading shared pool chunks
-- Problem: Current policy blocks access to chunks where agent_id = NULL (shared pool)
-- Solution: Allow reading chunks that either belong to user's agents OR are in shared pool

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can read their own agent knowledge" ON agent_knowledge;

-- Create new policy that allows reading both owned agent chunks AND shared pool chunks
CREATE POLICY "Users can read agent chunks and shared pool"
ON agent_knowledge
FOR SELECT
USING (
  -- Allow if chunk belongs to user's agent
  (EXISTS ( 
    SELECT 1
    FROM agents
    WHERE agents.id = agent_knowledge.agent_id 
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  ))
  OR
  -- Allow if chunk is in shared pool (agent_id = NULL and pool_document_id is set)
  (agent_knowledge.agent_id IS NULL AND agent_knowledge.pool_document_id IS NOT NULL)
);

-- Also update INSERT policy to allow inserting shared pool chunks
DROP POLICY IF EXISTS "Users can insert knowledge for their agents" ON agent_knowledge;

CREATE POLICY "Users can insert agent chunks and shared pool"
ON agent_knowledge
FOR INSERT
WITH CHECK (
  -- Allow if inserting for user's agent
  (EXISTS ( 
    SELECT 1
    FROM agents
    WHERE agents.id = agent_knowledge.agent_id 
      AND (agents.user_id = auth.uid() OR agents.user_id IS NULL)
  ))
  OR
  -- Allow if inserting into shared pool (agent_id = NULL)
  (agent_knowledge.agent_id IS NULL AND agent_knowledge.pool_document_id IS NOT NULL)
);