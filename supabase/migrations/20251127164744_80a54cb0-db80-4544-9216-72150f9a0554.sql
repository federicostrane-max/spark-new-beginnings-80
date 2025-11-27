-- Drop legacy RPC functions that reference deleted agent_knowledge.source_type column
-- These functions are no longer needed after legacy pipeline deletion

DROP FUNCTION IF EXISTS public.find_orphaned_chunks();
DROP FUNCTION IF EXISTS public.consolidate_pool_chunks();
DROP FUNCTION IF EXISTS public.consolidate_pool_chunks_batch(integer);