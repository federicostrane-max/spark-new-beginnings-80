-- Query Expansion Cache for LLM-based hybrid expansion
CREATE TABLE public.query_expansion_cache (
  query_hash TEXT PRIMARY KEY,
  original_query TEXT NOT NULL,
  expanded_query TEXT NOT NULL,
  expansion_source TEXT NOT NULL DEFAULT 'llm', -- 'llm' or 'dictionary'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for analytics/debugging
CREATE INDEX idx_query_expansion_cache_created ON query_expansion_cache(created_at DESC);

-- RLS policies
ALTER TABLE public.query_expansion_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System can manage query expansion cache"
ON public.query_expansion_cache
FOR ALL
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can read cache"
ON public.query_expansion_cache
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Comment
COMMENT ON TABLE public.query_expansion_cache IS 'Cache for LLM-expanded financial queries to avoid repeated API calls';