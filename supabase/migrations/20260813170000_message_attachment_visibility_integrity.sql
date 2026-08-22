-- Canonical message-attachment visibility and Storage integrity.
--
-- A message attachment contains more than a filename: its row may carry the
-- private Storage path, extracted text, and OCR. Circle membership alone is
-- therefore not sufficient read authority. Converge the full table policy set
-- so staged rows are owner-only and linked rows follow the exact message-thread
-- visibility contract. Apply the same rule to the private Storage object.

BEGIN;

-- §40 deliberately extends §39 rather than replacing its immutable-link
-- trigger. Abort intact if an operator tries to install visibility before the
-- canonical compare-and-set boundary is present.
DO $attachment_visibility_dependency_preflight$
BEGIN
  IF to_regprocedure('public.message_attachment_link_target_is_valid_v1(uuid,uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.guard_authenticated_message_attachment_update_v1()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'public.message_attachments'::regclass
         AND trigger_row.tgname = 'trg_guard_authenticated_message_attachment_update_v1'
         AND trigger_row.tgenabled <> 'D'
         AND NOT trigger_row.tgisinternal
     )
     OR to_regprocedure('public.message_thread_visible_to_current_user(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: apply SQL section 39 and canonical message-thread RLS first'
      USING ERRCODE = '23514';
  END IF;
END
$attachment_visibility_dependency_preflight$;

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.message_attachment_storage_path_matches_row_v1(
  p_name text,
  p_circle_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    p_name IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 4
    AND split_part(p_name, '/', 1) = p_circle_id::text
    AND split_part(p_name, '/', 2) = COALESCE(p_thread_id::text, '_direct')
    AND split_part(p_name, '/', 3) = p_user_id::text
    AND split_part(p_name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$';
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_storage_path_matches_row_v1(text, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_path_matches_row_v1(text, uuid, uuid, uuid)
TO authenticated;

-- Never delete or silently rewrite a user's attachment while installing an
-- authority boundary. Legacy drift must be inspected by an operator. Abort the
-- transaction intact if a row cannot satisfy the canonical path identity.
DO $attachment_path_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.message_attachments AS attachment
    WHERE NOT public.message_attachment_storage_path_matches_row_v1(
      attachment.storage_path,
      attachment.circle_id,
      attachment.thread_id,
      attachment.user_id
    )
  ) THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: invalid legacy storage path; inspect before applying'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.message_attachments AS attachment
    GROUP BY attachment.storage_path
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: duplicate legacy storage path; inspect before applying'
      USING ERRCODE = '23505';
  END IF;
END
$attachment_path_preflight$;

ALTER TABLE public.message_attachments
  DROP CONSTRAINT IF EXISTS message_attachments_storage_path_matches_scope_v1;
ALTER TABLE public.message_attachments
  ADD CONSTRAINT message_attachments_storage_path_matches_scope_v1
  CHECK (
    public.message_attachment_storage_path_matches_row_v1(
      storage_path,
      circle_id,
      thread_id,
      user_id
    )
  );

DROP INDEX IF EXISTS public.message_attachments_storage_path_unique_v1;
CREATE UNIQUE INDEX message_attachments_storage_path_unique_v1
ON public.message_attachments(storage_path);

-- Converge the named private bucket without deleting or replacing it. A
-- mismatched id/name is ambiguous operator state and aborts intact.
DO $private_bucket_identity_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE (bucket.id = 'chat-attachments' AND bucket.name <> 'chat-attachments')
       OR (bucket.name = 'chat-attachments' AND bucket.id <> 'chat-attachments')
  ) THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: chat-attachments bucket identity mismatch; inspect before applying'
      USING ERRCODE = '23514';
  END IF;
END
$private_bucket_identity_preflight$;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', false, 52428800)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = 52428800;

UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 52428800
WHERE id = 'chat-attachments'
  AND name = 'chat-attachments';

-- Metadata is admitted only after the exact private Storage object exists and
-- its immutable owner matches the row/path owner. The authenticated-only
-- owner equality prevents this SECURITY DEFINER predicate from becoming a
-- cross-user object-existence oracle.
CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_matches_row_v1(
  p_name text,
  p_circle_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
    AND public.message_attachment_storage_path_matches_row_v1(
      p_name,
      p_circle_id,
      p_thread_id,
      p_user_id
    )
    AND EXISTS (
      SELECT 1
      FROM storage.objects AS object_row
      WHERE object_row.bucket_id = 'chat-attachments'
        AND object_row.name = p_name
        AND object_row.owner_id::text = p_user_id::text
    );
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_storage_object_matches_row_v1(text, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_object_matches_row_v1(text, uuid, uuid, uuid)
TO authenticated;

-- A missing or differently owned legacy object is not repaired by guessing.
-- Keep every row/object intact and stop the transaction for operator review.
DO $attachment_object_binding_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.message_attachments AS attachment
    WHERE NOT EXISTS (
      SELECT 1
      FROM storage.objects AS object_row
      WHERE object_row.bucket_id = 'chat-attachments'
        AND object_row.name = attachment.storage_path
        AND object_row.owner_id::text = attachment.user_id::text
    )
  ) THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: missing or owner-mismatched legacy storage object; inspect before applying'
      USING ERRCODE = '23514';
  END IF;
END
$attachment_object_binding_preflight$;

CREATE OR REPLACE FUNCTION public.message_attachment_row_visible_v1(
  p_message_id uuid,
  p_circle_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND (
      (
        p_message_id IS NULL
        AND p_user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.circle_members AS membership
          WHERE membership.circle_id = p_circle_id
            AND membership.user_id = auth.uid()
        )
      )
      OR (
        p_message_id IS NOT NULL
        AND p_thread_id IS NOT NULL
        AND public.message_thread_visible_to_current_user(p_circle_id, p_thread_id)
        AND EXISTS (
          SELECT 1
          FROM public.messages AS target_message
          WHERE target_message.id = p_message_id
            AND target_message.circle_id = p_circle_id
            AND target_message.thread_id = p_thread_id
            AND target_message.user_id = p_user_id
            AND COALESCE(target_message.is_bot, false) = false
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_row_visible_v1(uuid, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_row_visible_v1(uuid, uuid, uuid, uuid)
TO authenticated;

-- Permissive policies are ORed. Remove every historical table policy before
-- installing the one canonical policy for each operation.
DO $attachment_policy_convergence$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.message_attachments',
      policy_row.policyname
    );
  END LOOP;
END
$attachment_policy_convergence$;

CREATE POLICY message_attachments_select_exact_visibility_v1
ON public.message_attachments
FOR SELECT
TO authenticated
USING (
  public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_insert_owner_staged_v1
ON public.message_attachments
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND (
    thread_id IS NULL
    OR public.message_thread_visible_to_current_user(circle_id, thread_id)
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_object_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_update_owner_exact_link_v1
ON public.message_attachments
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND (
    thread_id IS NULL
    OR public.message_thread_visible_to_current_user(circle_id, thread_id)
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_object_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_delete_owner_visible_v1
ON public.message_attachments
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

-- Restrictive companions are defense in depth against a future or
-- environment-specific permissive TO PUBLIC/FOR ALL policy. PostgreSQL ANDs
-- every applicable restrictive policy with the permissive result.
CREATE POLICY message_attachments_select_exact_visibility_guard_v1
ON public.message_attachments
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_insert_owner_staged_guard_v1
ON public.message_attachments
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND (
    thread_id IS NULL
    OR public.message_thread_visible_to_current_user(circle_id, thread_id)
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_object_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_update_owner_exact_link_guard_v1
ON public.message_attachments
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND (
    thread_id IS NULL
    OR public.message_thread_visible_to_current_user(circle_id, thread_id)
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_object_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_delete_owner_visible_guard_v1
ON public.message_attachments
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

-- Explicit anon denials ensure a hostile permissive TO PUBLIC policy cannot
-- expose attachment metadata or content-bearing OCR/extraction columns.
CREATE POLICY message_attachments_anon_select_deny_v1
ON public.message_attachments
AS RESTRICTIVE
FOR SELECT
TO anon
USING (false);

CREATE POLICY message_attachments_anon_insert_deny_v1
ON public.message_attachments
AS RESTRICTIVE
FOR INSERT
TO anon
WITH CHECK (false);

CREATE POLICY message_attachments_anon_update_deny_v1
ON public.message_attachments
AS RESTRICTIVE
FOR UPDATE
TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY message_attachments_anon_delete_deny_v1
ON public.message_attachments
AS RESTRICTIVE
FOR DELETE
TO anon
USING (false);

REVOKE ALL ON TABLE public.message_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_attachments TO authenticated;
GRANT ALL ON TABLE public.message_attachments TO service_role;

-- Storage INSERT happens before the metadata row exists, so authority comes
-- from the exact path shape emitted by chatAttachments.ts:
--   <circle_uuid>/<thread_uuid|_direct>/<user_uuid>/<uuid>-<safe_name>
CREATE OR REPLACE FUNCTION public.message_attachment_storage_insert_authorized_v1(
  p_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_name IS NOT NULL
    AND array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 4
    AND split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND (
      split_part(p_name, '/', 2) = '_direct'
      OR split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND split_part(p_name, '/', 3) = auth.uid()::text
    AND split_part(p_name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = split_part(p_name, '/', 1)::uuid
        AND membership.user_id = auth.uid()
    )
    AND (
      split_part(p_name, '/', 2) = '_direct'
      OR public.message_thread_visible_to_current_user(
        split_part(p_name, '/', 1)::uuid,
        split_part(p_name, '/', 2)::uuid
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_visible_v1(
  p_name text,
  p_owner_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_owner_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.message_attachments AS attachment
      WHERE attachment.storage_path = p_name
        AND attachment.user_id::text = p_owner_id
        AND public.message_attachment_storage_path_matches_row_v1(
          attachment.storage_path,
          attachment.circle_id,
          attachment.thread_id,
          attachment.user_id
        )
        AND public.message_attachment_row_visible_v1(
          attachment.message_id,
          attachment.circle_id,
          attachment.thread_id,
          attachment.user_id
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_owned_v1(
  p_name text,
  p_owner_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_owner_id = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.message_attachments AS attachment
      WHERE attachment.storage_path = p_name
        AND attachment.user_id = auth.uid()
        AND attachment.user_id::text = p_owner_id
        AND public.message_attachment_storage_path_matches_row_v1(
          attachment.storage_path,
          attachment.circle_id,
          attachment.thread_id,
          attachment.user_id
        )
        AND public.message_attachment_row_visible_v1(
          attachment.message_id,
          attachment.circle_id,
          attachment.thread_id,
          attachment.user_id
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_storage_insert_authorized_v1(text)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_attachment_storage_object_visible_v1(text, text)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_attachment_storage_object_owned_v1(text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_insert_authorized_v1(text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_object_visible_v1(text, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_object_owned_v1(text, text)
TO authenticated;

-- Hosted Supabase owns storage.objects through supabase_storage_admin and
-- keeps RLS enabled. The postgres migration role may manage policies but must
-- not ALTER the platform-owned table.

DROP POLICY IF EXISTS chat_attachments_select_visible_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_select_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_insert_owned_scope_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_insert_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_update_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_delete_owner_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_delete_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_anon_select_deny_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_anon_insert_deny_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_anon_update_deny_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_anon_delete_deny_v1 ON storage.objects;

-- Remove the pre-release one-argument helper overloads only after their known
-- policies are gone. An unknown dependency fails the transaction rather than
-- cascading into another feature.
DROP FUNCTION IF EXISTS public.message_attachment_storage_object_visible_v1(text);
DROP FUNCTION IF EXISTS public.message_attachment_storage_object_owned_v1(text);

-- Canonical permissive policies keep this bucket functional. Restrictive
-- companion policies ensure an environment-specific broad Storage policy
-- cannot OR around the exact Chat attachment authority.
CREATE POLICY chat_attachments_select_visible_v1
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND public.message_attachment_storage_object_visible_v1(name, owner_id::text)
);

CREATE POLICY chat_attachments_select_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  bucket_id <> 'chat-attachments'
  OR public.message_attachment_storage_object_visible_v1(name, owner_id::text)
);

CREATE POLICY chat_attachments_insert_owned_scope_v1
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND owner_id::text = auth.uid()::text
  AND public.message_attachment_storage_insert_authorized_v1(name)
);

CREATE POLICY chat_attachments_insert_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id <> 'chat-attachments'
  OR (
    owner_id::text = auth.uid()::text
    AND public.message_attachment_storage_insert_authorized_v1(name)
  )
);

CREATE POLICY chat_attachments_update_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (bucket_id <> 'chat-attachments')
WITH CHECK (bucket_id <> 'chat-attachments');

CREATE POLICY chat_attachments_delete_owner_v1
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND owner_id::text = auth.uid()::text
  AND public.message_attachment_storage_object_owned_v1(name, owner_id::text)
);

CREATE POLICY chat_attachments_delete_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  bucket_id <> 'chat-attachments'
  OR (
    owner_id::text = auth.uid()::text
    AND public.message_attachment_storage_object_owned_v1(name, owner_id::text)
  )
);

-- A hostile or legacy permissive policy declared TO PUBLIC also applies to
-- anon. Operation-specific restrictive anon policies make the private bucket
-- unreachable even in that environment; other buckets remain unaffected.
CREATE POLICY chat_attachments_anon_select_deny_v1
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO anon
USING (bucket_id <> 'chat-attachments');

CREATE POLICY chat_attachments_anon_insert_deny_v1
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO anon
WITH CHECK (bucket_id <> 'chat-attachments');

CREATE POLICY chat_attachments_anon_update_deny_v1
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO anon
USING (bucket_id <> 'chat-attachments')
WITH CHECK (bucket_id <> 'chat-attachments');

CREATE POLICY chat_attachments_anon_delete_deny_v1
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO anon
USING (bucket_id <> 'chat-attachments');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- §40 readiness (catalog and policy convergence only; follow with an
-- authenticated two-user private/shared/circle-thread and Storage test).
SELECT
  EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE bucket.id = 'chat-attachments'
      AND bucket.name = 'chat-attachments'
      AND bucket.public = false
      AND bucket.file_size_limit = 52428800
  ) AS attachment_bucket_private_ready,
  to_regprocedure('public.message_attachment_link_target_is_valid_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.guard_authenticated_message_attachment_update_v1()') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.message_attachments'::regclass
        AND trigger_row.tgname = 'trg_guard_authenticated_message_attachment_update_v1'
        AND trigger_row.tgenabled <> 'D'
        AND NOT trigger_row.tgisinternal
    ) AS attachment_link_integrity_compatible,
  to_regprocedure('public.message_attachment_storage_path_matches_row_v1(text,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.message_attachment_storage_object_matches_row_v1(text,uuid,uuid,uuid)') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.message_attachments'::regclass
        AND constraint_row.conname = 'message_attachments_storage_path_matches_scope_v1'
        AND constraint_row.convalidated
    )
    AND to_regclass('public.message_attachments_storage_path_unique_v1') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.message_attachments AS attachment
      WHERE NOT public.message_attachment_storage_path_matches_row_v1(
        attachment.storage_path,
        attachment.circle_id,
        attachment.thread_id,
        attachment.user_id
      )
        OR NOT EXISTS (
          SELECT 1
          FROM storage.objects AS object_row
          WHERE object_row.bucket_id = 'chat-attachments'
            AND object_row.name = attachment.storage_path
            AND object_row.owner_id::text = attachment.user_id::text
        )
    ) AS attachment_storage_path_identity_ready,
  to_regprocedure('public.message_attachment_row_visible_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.message_attachment_storage_insert_authorized_v1(text)') IS NOT NULL
    AND to_regprocedure('public.message_attachment_storage_object_visible_v1(text,text)') IS NOT NULL
    AND to_regprocedure('public.message_attachment_storage_object_owned_v1(text,text)') IS NOT NULL
    AS attachment_visibility_helpers_ready,
  (
    SELECT count(*) = 12
      AND count(*) FILTER (WHERE permissive = 'PERMISSIVE') = 4
      AND count(*) FILTER (WHERE permissive = 'RESTRICTIVE') = 8
      AND count(*) FILTER (WHERE roles = ARRAY['authenticated']::name[]) = 8
      AND count(*) FILTER (WHERE roles = ARRAY['anon']::name[]) = 4
      AND count(*) FILTER (WHERE cmd = 'SELECT' AND qual IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'INSERT' AND with_check IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'UPDATE' AND qual IS NOT NULL AND with_check IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'DELETE' AND qual IS NOT NULL) = 3
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
      AND policyname IN (
        'message_attachments_select_exact_visibility_v1',
        'message_attachments_insert_owner_staged_v1',
        'message_attachments_update_owner_exact_link_v1',
        'message_attachments_delete_owner_visible_v1',
        'message_attachments_select_exact_visibility_guard_v1',
        'message_attachments_insert_owner_staged_guard_v1',
        'message_attachments_update_owner_exact_link_guard_v1',
        'message_attachments_delete_owner_visible_guard_v1',
        'message_attachments_anon_select_deny_v1',
        'message_attachments_anon_insert_deny_v1',
        'message_attachments_anon_update_deny_v1',
        'message_attachments_anon_delete_deny_v1'
      )
  ) AS attachment_table_policies_converged,
  (
    SELECT count(*) = 11
      AND count(*) FILTER (WHERE permissive = 'PERMISSIVE') = 3
      AND count(*) FILTER (WHERE permissive = 'RESTRICTIVE') = 8
      AND count(*) FILTER (WHERE roles = ARRAY['authenticated']::name[]) = 7
      AND count(*) FILTER (WHERE roles = ARRAY['anon']::name[]) = 4
      AND count(*) FILTER (WHERE cmd = 'SELECT' AND qual IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'INSERT' AND with_check IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'UPDATE' AND qual IS NOT NULL AND with_check IS NOT NULL) = 2
      AND count(*) FILTER (WHERE cmd = 'DELETE' AND qual IS NOT NULL) = 3
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'chat_attachments_select_visible_v1',
        'chat_attachments_select_guard_v1',
        'chat_attachments_insert_owned_scope_v1',
        'chat_attachments_insert_guard_v1',
        'chat_attachments_update_guard_v1',
        'chat_attachments_delete_owner_v1',
        'chat_attachments_delete_guard_v1',
        'chat_attachments_anon_select_deny_v1',
        'chat_attachments_anon_insert_deny_v1',
        'chat_attachments_anon_update_deny_v1',
        'chat_attachments_anon_delete_deny_v1'
      )
  ) AS attachment_storage_policies_converged,
  has_table_privilege('authenticated', 'public.message_attachments', 'SELECT')
    AND has_table_privilege('authenticated', 'public.message_attachments', 'INSERT')
    AND has_table_privilege('authenticated', 'public.message_attachments', 'UPDATE')
    AND has_table_privilege('authenticated', 'public.message_attachments', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.message_attachments', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.message_attachments', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.message_attachments', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.message_attachments', 'DELETE')
    AND has_table_privilege('service_role', 'public.message_attachments', 'SELECT')
    AND has_table_privilege('service_role', 'public.message_attachments', 'INSERT')
    AND has_table_privilege('service_role', 'public.message_attachments', 'UPDATE')
    AND has_table_privilege('service_role', 'public.message_attachments', 'DELETE')
    AS attachment_table_grants_ready;
