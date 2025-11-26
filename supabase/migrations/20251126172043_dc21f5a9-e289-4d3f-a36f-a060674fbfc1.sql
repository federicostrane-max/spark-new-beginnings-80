-- Enable RLS policies for pipeline-a-uploads bucket to allow video uploads

-- Policy: Allow authenticated users to upload videos to pipeline-a-uploads bucket
CREATE POLICY "Allow authenticated users to upload videos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'pipeline-a-uploads' 
  AND (storage.foldername(name))[1] = 'videos'
);

-- Policy: Allow authenticated users to read their uploaded videos
CREATE POLICY "Allow authenticated users to read videos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'pipeline-a-uploads'
  AND (storage.foldername(name))[1] = 'videos'
);

-- Policy: Allow authenticated users to delete their uploaded videos
CREATE POLICY "Allow authenticated users to delete videos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'pipeline-a-uploads'
  AND (storage.foldername(name))[1] = 'videos'
);