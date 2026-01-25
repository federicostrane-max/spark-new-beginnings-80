-- Create debug_logs table for storing console logs
-- Claude can read these logs to debug issues autonomously

CREATE TABLE IF NOT EXISTS public.debug_logs (
  id TEXT PRIMARY KEY DEFAULT 'default',
  logs JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow all operations (this is for debugging only)
ALTER TABLE public.debug_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on debug_logs" ON public.debug_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Grant access
GRANT ALL ON public.debug_logs TO anon, authenticated;
