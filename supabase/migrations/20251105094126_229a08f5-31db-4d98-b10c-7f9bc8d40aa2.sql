-- Add enhanced metadata fields to search_results_cache table
ALTER TABLE search_results_cache
ADD COLUMN IF NOT EXISTS source_type TEXT,
ADD COLUMN IF NOT EXISTS credibility_score INTEGER,
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER;

-- Add comment explaining the new fields
COMMENT ON COLUMN search_results_cache.source_type IS 'Type of source: preprint, journal, institutional, repository, web';
COMMENT ON COLUMN search_results_cache.credibility_score IS 'Credibility score from 1-10 based on domain whitelist';
COMMENT ON COLUMN search_results_cache.verified IS 'Whether the PDF URL was verified with HEAD request';
COMMENT ON COLUMN search_results_cache.file_size_bytes IS 'File size in bytes from Content-Length header';