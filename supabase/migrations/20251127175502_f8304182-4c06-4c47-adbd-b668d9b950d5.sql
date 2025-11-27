-- Create llamaparse_debug_logs table for storing raw JSON output from LlamaParse tests
CREATE TABLE llamaparse_debug_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_name TEXT NOT NULL,
  parse_settings JSONB NOT NULL,
  raw_json_output JSONB,
  images_info JSONB,
  element_types_found TEXT[],
  total_elements INTEGER,
  has_reading_order BOOLEAN,
  has_bounding_boxes BOOLEAN,
  bbox_format TEXT,
  image_format TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE llamaparse_debug_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read and insert debug logs
CREATE POLICY "Authenticated users can read debug logs"
  ON llamaparse_debug_logs
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert debug logs"
  ON llamaparse_debug_logs
  FOR INSERT
  WITH CHECK (true);