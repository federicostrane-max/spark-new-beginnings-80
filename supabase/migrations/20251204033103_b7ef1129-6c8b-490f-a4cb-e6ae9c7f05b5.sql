-- Benchmark Jobs Queue for Event-Driven Processing
CREATE TABLE public.benchmark_jobs_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  question_id UUID REFERENCES benchmark_datasets(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error_message TEXT,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Indexes for efficient querying
CREATE INDEX idx_benchmark_jobs_status ON benchmark_jobs_queue(status);
CREATE INDEX idx_benchmark_jobs_run_id ON benchmark_jobs_queue(run_id);
CREATE INDEX idx_benchmark_jobs_pending ON benchmark_jobs_queue(status, created_at) WHERE status = 'pending';

-- Enable RLS
ALTER TABLE public.benchmark_jobs_queue ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on benchmark_jobs_queue"
ON public.benchmark_jobs_queue
FOR ALL
USING (true)
WITH CHECK (true);

-- Trigger function to invoke process-benchmark-job on INSERT
CREATE OR REPLACE FUNCTION trigger_benchmark_job_processing()
RETURNS TRIGGER AS $$
DECLARE
  edge_function_url TEXT;
  service_key TEXT;
BEGIN
  -- Get settings from Supabase config
  edge_function_url := 'https://vjeafbnkycxfzpwxkifw.supabase.co/functions/v1/process-benchmark-job';
  
  -- Use pg_net to call edge function asynchronously
  PERFORM net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('job_id', NEW.id)
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on INSERT
CREATE TRIGGER on_benchmark_job_created
AFTER INSERT ON benchmark_jobs_queue
FOR EACH ROW
EXECUTE FUNCTION trigger_benchmark_job_processing();

-- Enable realtime for progress tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.benchmark_jobs_queue;