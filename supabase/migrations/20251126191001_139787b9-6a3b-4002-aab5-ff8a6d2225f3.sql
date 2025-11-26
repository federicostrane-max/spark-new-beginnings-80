ALTER TABLE pipeline_a_documents 
ADD COLUMN processing_metadata JSONB DEFAULT NULL;

COMMENT ON COLUMN pipeline_a_documents.processing_metadata IS 
'Metadata del processing video: prompt generato dal Director, tipo di elaborazione, versione, etc.';