-- Drop existing policies
DROP POLICY IF EXISTS "Authenticated users can upload knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete knowledge files" ON storage.objects;

-- Allow authenticated users to upload files to their own folder
CREATE POLICY "Authenticated users can upload knowledge files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'knowledge-pdfs' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to read knowledge files
CREATE POLICY "Authenticated users can read knowledge files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'knowledge-pdfs');

-- Allow authenticated users to delete their own knowledge files
CREATE POLICY "Authenticated users can delete knowledge files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'knowledge-pdfs' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);