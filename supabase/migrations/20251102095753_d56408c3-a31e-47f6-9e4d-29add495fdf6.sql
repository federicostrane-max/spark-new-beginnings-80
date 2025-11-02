-- Drop the existing delete policy
DROP POLICY IF EXISTS "Users can delete their own agents" ON agents;

-- Create a new delete policy that allows deleting owned agents OR agents without a user_id
CREATE POLICY "Users can delete their own agents or unowned agents" 
ON agents 
FOR DELETE 
USING (auth.uid() = user_id OR user_id IS NULL);