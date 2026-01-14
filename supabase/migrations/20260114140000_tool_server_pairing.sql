-- Tool Server Pairing System
-- Creates tables for one-time pairing between Web App and Desktop App

-- ============================================================================
-- Table 1: Temporary pairing tokens (expire after 10 minutes)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tool_server_pairing_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token VARCHAR(6) UNIQUE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes')
);

ALTER TABLE public.tool_server_pairing_tokens ENABLE ROW LEVEL SECURITY;

-- Users can create their own tokens
CREATE POLICY "Users can create own tokens" ON public.tool_server_pairing_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can view their own tokens
CREATE POLICY "Users can view own tokens" ON public.tool_server_pairing_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Users can delete their own tokens
CREATE POLICY "Users can delete own tokens" ON public.tool_server_pairing_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_token ON public.tool_server_pairing_tokens(token);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_user ON public.tool_server_pairing_tokens(user_id);

-- ============================================================================
-- Table 2: Persistent tool server configuration (for Realtime sync)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tool_server_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  ngrok_url TEXT,
  device_name TEXT DEFAULT 'Desktop',
  device_secret UUID DEFAULT gen_random_uuid() NOT NULL,
  paired_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tool_server_config ENABLE ROW LEVEL SECURITY;

-- Users can view their own config
CREATE POLICY "Users can view own config" ON public.tool_server_config
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own config (for disconnect)
CREATE POLICY "Users can update own config" ON public.tool_server_config
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own config (for disconnect)
CREATE POLICY "Users can delete own config" ON public.tool_server_config
  FOR DELETE USING (auth.uid() = user_id);

-- Service role can insert (used by edge function during pairing)
CREATE POLICY "Service role can insert config" ON public.tool_server_config
  FOR INSERT WITH CHECK (true);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_tool_server_config_user ON public.tool_server_config(user_id);

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE tool_server_config;

-- ============================================================================
-- Cleanup function: Remove expired tokens (run periodically)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_pairing_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM public.tool_server_pairing_tokens
  WHERE expires_at < NOW() OR used = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
