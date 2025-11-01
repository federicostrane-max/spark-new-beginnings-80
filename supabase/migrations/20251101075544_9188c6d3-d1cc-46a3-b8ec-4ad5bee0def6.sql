-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Authenticated users can view active agents" ON public.agents;

-- Create new public read policy for active agents
CREATE POLICY "Anyone can view active agents"
ON public.agents
FOR SELECT
USING (active = true);