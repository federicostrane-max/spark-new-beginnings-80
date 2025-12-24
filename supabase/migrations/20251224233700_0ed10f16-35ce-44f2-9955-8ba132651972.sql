-- Drop existing UPDATE policy on agents
DROP POLICY IF EXISTS "Users can update their own agents" ON agents;

-- Create new policy that allows updating own agents OR claiming legacy agents (user_id = NULL)
CREATE POLICY "Users can update their own agents or claim legacy agents"
ON agents
FOR UPDATE
USING ((auth.uid() = user_id) OR (user_id IS NULL))
WITH CHECK ((auth.uid() = user_id) OR (user_id IS NULL));