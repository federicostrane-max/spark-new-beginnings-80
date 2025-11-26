
-- Enable Realtime for Pipeline A tables
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_a_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_a_chunks_raw;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_a_agent_knowledge;
