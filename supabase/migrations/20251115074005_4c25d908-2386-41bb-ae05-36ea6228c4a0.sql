-- Enable realtime for knowledge_documents and document_processing_cache
ALTER PUBLICATION supabase_realtime ADD TABLE knowledge_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE document_processing_cache;