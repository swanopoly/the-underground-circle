-- Add image_url column to tasks for image attachments
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS image_url text;

-- Create storage bucket for task images (public read, auth write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-images', 'task-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload task images
CREATE POLICY "Authenticated users can upload task images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'task-images');

-- Allow public read access to task images
CREATE POLICY "Public read access for task images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'task-images');

-- Allow users to delete their own task images
CREATE POLICY "Users can delete task images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'task-images');
