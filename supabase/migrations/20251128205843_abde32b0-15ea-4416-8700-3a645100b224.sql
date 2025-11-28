-- Create benchmark_suites metadata registry
CREATE TABLE benchmark_suites (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  capabilities JSONB DEFAULT '[]'::jsonb,
  target_personas JSONB DEFAULT '[]'::jsonb,
  source_type TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE benchmark_suites ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users to read suites
CREATE POLICY "Authenticated users can read benchmark suites"
  ON benchmark_suites FOR SELECT TO authenticated USING (true);

-- Populate with all 8 benchmark suites
INSERT INTO benchmark_suites (slug, name, description, capabilities, target_personas, source_type, source_url) VALUES
  ('general', 'General (DocVQA)', 'Document visual question answering on diverse documents', 
   '["ocr", "layout", "handwriting"]', '["analyst", "legal"]', 'huggingface', 'lmms-lab/DocVQA'),
  ('finance', 'Finance (FinQA)', 'Financial table reasoning and calculation', 
   '["tables", "math", "reasoning"]', '["accountant", "cfo", "investor"]', 'github', 'czyssrs/FinQA'),
  ('charts', 'Charts (ChartQA)', 'Visual chart understanding and data extraction', 
   '["vision", "graphs", "data-analysis"]', '["trader", "analyst", "data-scientist"]', 'github', 'vis-nlp/ChartQA'),
  ('receipts', 'Receipts (CORD)', 'Receipt parsing and structured extraction', 
   '["ocr", "extraction", "structured-data"]', '["accountant", "expense-manager"]', 'huggingface', 'naver-clova-ix/cord-v2'),
  ('science', 'Science (QASPER)', 'Scientific paper question answering', 
   '["long-context", "technical", "citations"]', '["researcher", "phd-student"]', 'huggingface', 'allenai/qasper'),
  ('narrative', 'Narrative (NarrativeQA)', 'Long narrative comprehension', 
   '["long-context", "comprehension", "summarization"]', '["editor", "writer"]', 'huggingface', 'deepmind/narrativeqa'),
  ('code', 'Code (GitHub)', 'Source code analysis and explanation', 
   '["code-analysis", "typescript", "api-docs"]', '["developer", "cto", "tech-lead"]', 'github', 'alexreardon/tiny-invariant'),
  ('safety', 'Safety (Adversarial)', 'Off-topic and adversarial question handling', 
   '["security", "compliance", "boundary-testing"]', '["auditor", "qa-engineer"]', 'generated', NULL);