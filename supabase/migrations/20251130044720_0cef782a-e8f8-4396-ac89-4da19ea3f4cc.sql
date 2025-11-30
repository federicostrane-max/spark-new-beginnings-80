-- Create visual_enrichment_queue table for async image processing
CREATE TABLE IF NOT EXISTS public.visual_enrichment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES pipeline_a_hybrid_documents(id) ON DELETE CASCADE,
  image_base64 TEXT,
  storage_path TEXT,
  image_metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  enrichment_text TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  chunk_id UUID REFERENCES pipeline_a_hybrid_chunks_raw(id) ON DELETE SET NULL
);

-- Create index for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_visual_queue_status ON visual_enrichment_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_visual_queue_document ON visual_enrichment_queue(document_id);

-- Enable RLS
ALTER TABLE visual_enrichment_queue ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated users can read all queue items
CREATE POLICY "Authenticated users can read vision queue"
  ON visual_enrichment_queue
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: system can manage queue
CREATE POLICY "System can manage vision queue"
  ON visual_enrichment_queue
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);