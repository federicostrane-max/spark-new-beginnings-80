-- Add metadata column to processing_jobs for storing trace reports
ALTER TABLE public.processing_jobs 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;