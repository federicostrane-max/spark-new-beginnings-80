-- ===== BENCHMARK DATASETS TABLE =====
-- Table per storage centralizzato di Q&A da tutte le suite

CREATE TABLE benchmark_datasets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name TEXT NOT NULL,
  storage_path TEXT,
  suite_category TEXT NOT NULL CHECK (suite_category IN ('finance', 'charts', 'general', 'safety')),
  question TEXT NOT NULL,
  ground_truth TEXT NOT NULL,
  question_language TEXT DEFAULT 'en',
  source_repo TEXT,
  source_metadata JSONB DEFAULT '{}',
  document_id UUID REFERENCES pipeline_a_hybrid_documents(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  provisioned_at TIMESTAMPTZ
);

-- Indici per query veloci per suite
CREATE INDEX idx_benchmark_datasets_suite ON benchmark_datasets(suite_category);
CREATE INDEX idx_benchmark_datasets_document ON benchmark_datasets(document_id);
CREATE INDEX idx_benchmark_datasets_active ON benchmark_datasets(is_active) WHERE is_active = true;

-- RLS Policies
ALTER TABLE benchmark_datasets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read benchmark datasets"
  ON benchmark_datasets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert benchmark datasets"
  ON benchmark_datasets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update benchmark datasets"
  ON benchmark_datasets FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete benchmark datasets"
  ON benchmark_datasets FOR DELETE
  TO authenticated
  USING (true);

COMMENT ON TABLE benchmark_datasets IS 'Storage centralizzato per Q&A pairs da tutte le suite di benchmark (FinQA, ChartQA, DocVQA, Safety)';
COMMENT ON COLUMN benchmark_datasets.suite_category IS 'Categoria del test: finance (FinQA), charts (ChartQA), general (DocVQA), safety (adversarial)';
COMMENT ON COLUMN benchmark_datasets.source_metadata IS 'JSON originale preservato dal dataset di provenienza per debugging';