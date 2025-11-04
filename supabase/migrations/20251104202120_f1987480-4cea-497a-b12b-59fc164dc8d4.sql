-- Create table to cache search results with URLs
CREATE TABLE IF NOT EXISTS public.search_results_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  result_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  authors TEXT,
  year TEXT,
  source TEXT,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(conversation_id, result_number)
);

-- Enable RLS
ALTER TABLE public.search_results_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view cache for their conversations
CREATE POLICY "Users can view search cache for their conversations"
ON public.search_results_cache
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.agent_conversations c
    WHERE c.id = search_results_cache.conversation_id
    AND c.user_id = auth.uid()::text
  )
);

-- Policy: System can insert search results
CREATE POLICY "System can insert search cache"
ON public.search_results_cache
FOR INSERT
WITH CHECK (true);

-- Policy: System can delete old cache
CREATE POLICY "System can delete search cache"
ON public.search_results_cache
FOR DELETE
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_search_cache_conversation ON public.search_results_cache(conversation_id);