-- Enable realtime for Pipeline B documents and chunks
ALTER TABLE pipeline_b_documents REPLICA IDENTITY FULL;
ALTER TABLE pipeline_b_chunks_raw REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_b_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_b_chunks_raw;