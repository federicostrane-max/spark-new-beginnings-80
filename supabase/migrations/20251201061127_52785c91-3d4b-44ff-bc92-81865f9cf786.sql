-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Register pipeline-a-hybrid-process-chunks cron job (every 10 minutes)
SELECT cron.schedule(
  'pipeline-a-hybrid-process-chunks-cron',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/pipeline-a-hybrid-process-chunks',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Register pipeline-a-hybrid-generate-embeddings cron job (every 5 minutes)
SELECT cron.schedule(
  'pipeline-a-hybrid-generate-embeddings-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/pipeline-a-hybrid-generate-embeddings',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Register process-vision-queue cron job (every minute)
SELECT cron.schedule(
  'process-vision-queue-cron',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/process-vision-queue',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Reset stuck FinanceBench document to ingested status
UPDATE pipeline_a_hybrid_documents 
SET 
  status = 'ingested',
  error_message = NULL,
  llamaparse_job_id = NULL,
  processing_metadata = '{}'::jsonb,
  updated_at = now()
WHERE id = '54afcceb-1d76-4e7f-9302-d32159ee8c6d';