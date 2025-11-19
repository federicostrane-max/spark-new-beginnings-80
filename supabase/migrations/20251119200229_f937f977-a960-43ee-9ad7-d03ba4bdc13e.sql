-- Fix security warning: add search_path to recategorize_github_documents function
CREATE OR REPLACE FUNCTION recategorize_github_documents()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE knowledge_documents
  SET folder = CASE 
    WHEN search_query LIKE '%huggingface/transformers%' THEN 'Huggingface_Transformers'
    WHEN search_query LIKE '%huggingface/diffusers%' THEN 'Huggingface_Diffusers'
    WHEN search_query LIKE '%huggingface/datasets%' THEN 'Huggingface_Datasets'
    WHEN search_query LIKE '%huggingface/peft%' THEN 'Huggingface_PEFT'
    WHEN search_query LIKE '%huggingface/hub-docs%' THEN 'Huggingface_Hub'
    ELSE folder
  END
  WHERE search_query LIKE 'GitHub:%' 
    AND folder = 'Huggingface_GitHub';
    
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;