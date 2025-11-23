
-- Function to clean up orphaned document links
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_document_links()
RETURNS TABLE(deleted_link_id uuid, agent_id uuid, document_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  DELETE FROM agent_document_links adl
  WHERE NOT EXISTS (
    SELECT 1 FROM knowledge_documents kd 
    WHERE kd.id = adl.document_id
  )
  RETURNING adl.id, adl.agent_id, adl.document_id;
END;
$$;

-- Trigger to automatically delete document links when document is deleted
CREATE OR REPLACE FUNCTION public.delete_document_links_on_document_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Delete all agent_document_links for this document
  DELETE FROM agent_document_links
  WHERE document_id = OLD.id;
  
  -- Delete all shared pool chunks for this document
  DELETE FROM agent_knowledge
  WHERE pool_document_id = OLD.id AND agent_id IS NULL;
  
  RETURN OLD;
END;
$$;

-- Create trigger on knowledge_documents DELETE
DROP TRIGGER IF EXISTS on_document_delete_cleanup ON knowledge_documents;
CREATE TRIGGER on_document_delete_cleanup
  BEFORE DELETE ON knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION delete_document_links_on_document_delete();

COMMENT ON FUNCTION public.cleanup_orphaned_document_links() IS 
'Removes agent_document_links entries where the referenced document no longer exists in knowledge_documents';

COMMENT ON FUNCTION public.delete_document_links_on_document_delete() IS 
'Automatically deletes agent_document_links and shared pool chunks when a document is deleted';
