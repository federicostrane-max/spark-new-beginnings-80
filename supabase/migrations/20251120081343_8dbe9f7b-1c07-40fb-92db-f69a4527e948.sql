
-- Rimuovi i trigger HTTP esistenti (non scalabili)
DROP TRIGGER IF EXISTS auto_process_pending_documents ON public.knowledge_documents;
DROP TRIGGER IF EXISTS auto_validate_ready_documents ON public.knowledge_documents;
DROP FUNCTION IF EXISTS public.trigger_process_document();
DROP FUNCTION IF EXISTS public.trigger_validate_document();

-- Crea una tabella di coda per il processing
CREATE TABLE IF NOT EXISTS public.document_processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  processing_type TEXT NOT NULL CHECK (processing_type IN ('extract', 'validate')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(document_id, processing_type)
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON public.document_processing_queue(status, processing_type);
CREATE INDEX IF NOT EXISTS idx_processing_queue_pending ON public.document_processing_queue(status) WHERE status = 'pending';

-- Funzione per aggiungere alla coda quando un documento diventa pending_processing
CREATE OR REPLACE FUNCTION public.enqueue_document_processing()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Se il documento è in pending_processing e non ha full_text, mettilo in coda per extraction
  IF NEW.processing_status = 'pending_processing' AND (NEW.full_text IS NULL OR NEW.full_text = '') THEN
    INSERT INTO public.document_processing_queue (document_id, processing_type)
    VALUES (NEW.id, 'extract')
    ON CONFLICT (document_id, processing_type) DO NOTHING;
  END IF;
  
  -- Se il documento è ready_for_assignment con validation pending, mettilo in coda per validazione
  IF NEW.processing_status = 'ready_for_assignment' AND NEW.validation_status = 'pending' THEN
    INSERT INTO public.document_processing_queue (document_id, processing_type)
    VALUES (NEW.id, 'validate')
    ON CONFLICT (document_id, processing_type) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger per popolare la coda
CREATE TRIGGER enqueue_processing
  AFTER INSERT OR UPDATE OF processing_status, validation_status
  ON public.knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_document_processing();

-- Popola la coda con i documenti esistenti che sono stuck
INSERT INTO public.document_processing_queue (document_id, processing_type)
SELECT id, 'extract'
FROM public.knowledge_documents
WHERE processing_status = 'pending_processing' 
  AND (full_text IS NULL OR full_text = '')
ON CONFLICT (document_id, processing_type) DO NOTHING;
