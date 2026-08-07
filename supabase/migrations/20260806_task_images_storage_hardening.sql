-- Task attachment storage hardening.
--
-- The original task-images policies authorized only by bucket id, so every
-- authenticated account could upload into any task path and delete objects
-- uploaded by another user. Keep the existing <task_id>/<filename> URL shape,
-- but bind writes to current circle membership and deletes to the uploader.

UPDATE storage.buckets
SET
  public = true,
  file_size_limit = 10485760, -- 10 MiB
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'application/pdf',
    'application/json',
    'text/plain',
    'text/markdown',
    'text/csv'
  ]::text[]
WHERE id = 'task-images';

CREATE OR REPLACE FUNCTION public.task_image_path_authorized(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/]+$'
    AND EXISTS (
      SELECT 1
      FROM public.tasks AS task
      JOIN public.circle_members AS membership
        ON membership.circle_id = task.circle_id
       AND membership.user_id = auth.uid()
      WHERE task.id::text = split_part(p_name, '/', 1)
    );
$function$;

REVOKE ALL ON FUNCTION public.task_image_path_authorized(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_image_path_authorized(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.task_image_path_authorized(text) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can upload task images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete task images" ON storage.objects;
DROP POLICY IF EXISTS "Task members can upload owned task images" ON storage.objects;
DROP POLICY IF EXISTS "Task image owners can delete own uploads" ON storage.objects;

CREATE POLICY "Task members can upload owned task images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'task-images'
  AND owner_id::text = auth.uid()::text
  AND public.task_image_path_authorized(name)
);

CREATE POLICY "Task image owners can delete own uploads"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'task-images'
  AND owner_id::text = auth.uid()::text
  AND public.task_image_path_authorized(name)
);

NOTIFY pgrst, 'reload schema';
