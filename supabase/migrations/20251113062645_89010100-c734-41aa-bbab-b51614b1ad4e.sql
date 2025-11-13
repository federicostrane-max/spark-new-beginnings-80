-- Create the shared-pool-uploads bucket for PDF storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shared-pool-uploads',
  'shared-pool-uploads',
  true,
  20971520, -- 20MB limit
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow authenticated users to upload PDFs
CREATE POLICY "authenticated_users_upload_shared_pool"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'shared-pool-uploads');

-- Policy: Allow public download of PDFs
CREATE POLICY "public_download_shared_pool"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'shared-pool-uploads');

-- Policy: Allow authenticated users to delete PDFs
CREATE POLICY "authenticated_users_delete_shared_pool"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'shared-pool-uploads');

-- Policy: Allow authenticated users to update PDFs
CREATE POLICY "authenticated_users_update_shared_pool"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'shared-pool-uploads');