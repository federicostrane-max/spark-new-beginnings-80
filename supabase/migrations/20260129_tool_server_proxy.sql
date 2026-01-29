-- Add ngrok_url and security_token to tool_server_pairing table if not exists

-- Check if table exists, if not create it
CREATE TABLE IF NOT EXISTS public.tool_server_pairing (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ngrok_url TEXT,
  security_token TEXT,
  device_secret TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
  UNIQUE(user_id)
);

-- Add columns if they don't exist (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tool_server_pairing' AND column_name='ngrok_url') THEN
    ALTER TABLE public.tool_server_pairing ADD COLUMN ngrok_url TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tool_server_pairing' AND column_name='security_token') THEN
    ALTER TABLE public.tool_server_pairing ADD COLUMN security_token TEXT;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.tool_server_pairing ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can read their own pairing" ON public.tool_server_pairing;
DROP POLICY IF EXISTS "Users can insert their own pairing" ON public.tool_server_pairing;
DROP POLICY IF EXISTS "Users can update their own pairing" ON public.tool_server_pairing;
DROP POLICY IF EXISTS "Users can delete their own pairing" ON public.tool_server_pairing;

-- Create RLS policies
CREATE POLICY "Users can read their own pairing"
  ON public.tool_server_pairing FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own pairing"
  ON public.tool_server_pairing FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pairing"
  ON public.tool_server_pairing FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own pairing"
  ON public.tool_server_pairing FOR DELETE
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON public.tool_server_pairing TO authenticated;
GRANT ALL ON public.tool_server_pairing TO service_role;
