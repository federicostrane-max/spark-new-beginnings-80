-- RLS policies for knowledge-pdfs bucket uploads

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload knowledge files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'knowledge-pdfs');

-- Allow authenticated users to read their own knowledge files
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
USING (bucket_id = 'knowledge-pdfs');