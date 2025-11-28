-- Tabella per salvare risultati benchmark e confrontare run nel tempo
CREATE TABLE benchmark_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  pdf_file TEXT NOT NULL,
  question TEXT NOT NULL,
  ground_truth TEXT NOT NULL,
  agent_response TEXT,
  correct BOOLEAN,
  reason TEXT,
  response_time_ms INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  retrieval_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indici per query veloci
CREATE INDEX idx_benchmark_results_run_id ON benchmark_results(run_id);
CREATE INDEX idx_benchmark_results_created_at ON benchmark_results(created_at DESC);
CREATE INDEX idx_benchmark_results_correct ON benchmark_results(correct);

-- RLS policies
ALTER TABLE benchmark_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all benchmark results"
  ON benchmark_results FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert benchmark results"
  ON benchmark_results FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE benchmark_results IS 'Storico risultati DocVQA Benchmark per analisi accuratezza nel tempo';