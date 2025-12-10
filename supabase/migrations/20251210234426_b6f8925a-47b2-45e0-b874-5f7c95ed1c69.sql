-- Allow authenticated users to upload PDFs to direct-uploads folder
CREATE POLICY "Allow authenticated users to upload direct PDFs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'pipeline-a-uploads' 
  AND (storage.foldername(name))[1] = 'direct-uploads'
);

-- Allow authenticated users to read direct uploads (for getPublicUrl)
CREATE POLICY "Allow authenticated users to read direct PDFs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'pipeline-a-uploads' 
  AND (storage.foldername(name))[1] = 'direct-uploads'
);