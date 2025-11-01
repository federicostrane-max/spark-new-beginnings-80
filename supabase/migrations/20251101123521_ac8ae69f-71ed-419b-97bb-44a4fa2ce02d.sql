-- Add user_id column to agents table to track ownership
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON public.agents(user_id);

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Anyone can view active agents" ON public.agents;

-- Create new policies for agents table
CREATE POLICY "Users can view all active agents"
ON public.agents
FOR SELECT
USING (active = true);

CREATE POLICY "Users can create their own agents"
ON public.agents
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own agents"
ON public.agents
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own agents"
ON public.agents
FOR DELETE
USING (auth.uid() = user_id);