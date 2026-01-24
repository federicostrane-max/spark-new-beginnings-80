-- Add missing cron jobs for Pipeline A, B, C embedding generation
-- These pipelines had documents stuck in 'chunked' status because there was no cron to process them

-- Enable required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Register pipeline-a-generate-embeddings cron job (every 5 minutes)
SELECT cron.schedule(
  'pipeline-a-generate-embeddings-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/pipeline-a-generate-embeddings',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Register pipeline-b-generate-embeddings cron job (every 5 minutes)
SELECT cron.schedule(
  'pipeline-b-generate-embeddings-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/pipeline-b-generate-embeddings',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Register pipeline-c-generate-embeddings cron job (every 5 minutes)
SELECT cron.schedule(
  'pipeline-c-generate-embeddings-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/pipeline-c-generate-embeddings',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Also add missing process-chunks cron jobs for consistency
-- Register pipeline-a-process-chunks cron job (every 10 minutes)
SELECT cron.schedule(
  'pipeline-a-process-chunks-cron',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/pipeline-a-process-chunks',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Register pipeline-b-process-chunks cron job (every 10 minutes)
SELECT cron.schedule(
  'pipeline-b-process-chunks-cron',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/pipeline-b-process-chunks',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- Register pipeline-c-process-chunks cron job (every 10 minutes)
SELECT cron.schedule(
  'pipeline-c-process-chunks-cron',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vjeafbnkycxfzpxwkifw.supabase.co/functions/v1/pipeline-c-process-chunks',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqZWFmYm5reWN4ZnpweHdraWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NjAzMzcsImV4cCI6MjA3NzUzNjMzN30.1l_a_qqBvKMVOhjlZs19aBlv1rm1ihfFENk3Tlr3oRY"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
