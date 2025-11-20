-- 1. Aggiorna la funzione per usare nomi gerarchici con prefissi
CREATE OR REPLACE FUNCTION public.recategorize_github_documents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE knowledge_documents
  SET folder = CASE 
    WHEN search_query LIKE '%huggingface/transformers%' THEN 'Huggingface_GitHub/Transformers'
    WHEN search_query LIKE '%huggingface/diffusers%' THEN 'Huggingface_GitHub/Diffusers'
    WHEN search_query LIKE '%huggingface/datasets%' THEN 'Huggingface_GitHub/Datasets'
    WHEN search_query LIKE '%huggingface/peft%' THEN 'Huggingface_GitHub/PEFT'
    WHEN search_query LIKE '%huggingface/hub-docs%' THEN 'Huggingface_GitHub/Hub'
    ELSE folder
  END
  WHERE search_query LIKE 'GitHub:%';
    
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

-- 2. Crea i record delle cartelle gerarchiche nella tabella folders
INSERT INTO public.folders (name, description, icon, color)
VALUES 
  ('Huggingface_GitHub/Transformers', 'Documentazione Hugging Face Transformers da GitHub', '🤗', '#ff6b6b'),
  ('Huggingface_GitHub/Diffusers', 'Documentazione Hugging Face Diffusers da GitHub', '🎨', '#4ecdc4'),
  ('Huggingface_GitHub/Datasets', 'Documentazione Hugging Face Datasets da GitHub', '📊', '#95e1d3'),
  ('Huggingface_GitHub/PEFT', 'Documentazione Hugging Face PEFT da GitHub', '⚡', '#ffe66d'),
  ('Huggingface_GitHub/Hub', 'Documentazione Hugging Face Hub da GitHub', '🌐', '#a8dadc')
ON CONFLICT (name) DO NOTHING;

-- 3. Esegui la ricategorizzazione con i nuovi nomi gerarchici
SELECT public.recategorize_github_documents();