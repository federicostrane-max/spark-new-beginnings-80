-- Mark documents without chunks and missing files as validation_failed
-- This fixes the issue where documents were marked as ready_for_assignment 
-- but have no chunks because the file doesn't exist in storage

DO $$
DECLARE
  doc_record RECORD;
  fixed_count INTEGER := 0;
BEGIN
  -- Find all documents that are marked as ready but have no chunks
  FOR doc_record IN 
    SELECT 
      kd.id,
      kd.file_name,
      kd.file_path
    FROM knowledge_documents kd
    LEFT JOIN agent_knowledge ak ON ak.pool_document_id = kd.id
    WHERE kd.processing_status = 'ready_for_assignment'
      AND kd.validation_status = 'validated'
    GROUP BY kd.id, kd.file_name, kd.file_path
    HAVING COUNT(ak.id) = 0
  LOOP
    -- Mark as validation_failed with clear reason
    UPDATE knowledge_documents
    SET 
      validation_status = 'validation_failed',
      processing_status = 'validation_failed',
      validation_reason = 'File not found in storage or no chunks could be extracted. Please re-upload this document.',
      updated_at = now()
    WHERE id = doc_record.id;
    
    fixed_count := fixed_count + 1;
    
    RAISE NOTICE 'Marked document as validation_failed: % (ID: %)', doc_record.file_name, doc_record.id;
  END LOOP;
  
  RAISE NOTICE 'Total documents marked as validation_failed: %', fixed_count;
END $$;