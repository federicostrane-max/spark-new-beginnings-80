
-- Abilita RLS sulla tabella di coda (admin-only access)
ALTER TABLE public.document_processing_queue ENABLE ROW LEVEL SECURITY;

-- Policy: solo funzioni di sistema possono accedere
CREATE POLICY "System access only" ON public.document_processing_queue
  FOR ALL
  USING (false);
