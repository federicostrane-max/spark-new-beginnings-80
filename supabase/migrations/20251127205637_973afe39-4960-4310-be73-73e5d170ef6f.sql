-- Enable Realtime for Pipeline A-Hybrid documents
ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_a_hybrid_documents;

-- Enable Realtime for Pipeline C documents
ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_c_documents;