-- Private, durable receipts for images generated from Chat and Office terminal.
--
-- Provider calls and Storage writes are service-role-only. Authenticated
-- clients receive short-lived signed URLs from the image-generate Edge
-- function after that function revalidates the source message through the
-- caller's exact RLS-scoped session.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_generated_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_scope text NOT NULL,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.circle_chat_threads(id) ON DELETE CASCADE,
  source_message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  requested_model text,
  prompt_sha256 text NOT NULL,
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_started_at timestamptz,
  provider_request_id text,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  sha256 text,
  failure_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_generated_images_scope_check_v1
    CHECK (generation_scope IN ('chat', 'terminal')),
  CONSTRAINT chat_generated_images_status_check_v1
    CHECK (status IN ('pending', 'ready', 'outcome_unknown')),
  CONSTRAINT chat_generated_images_provider_model_check_v1
    CHECK (
      (provider = 'openai' AND model = 'gpt-image-2')
      OR (
        provider = 'huggingface'
        AND model IN (
          'black-forest-labs/FLUX.1-schnell',
          'stabilityai/stable-diffusion-xl-base-1.0'
        )
      )
      OR (
        provider = 'replicate'
        AND model IN (
          'black-forest-labs/flux-schnell',
          'black-forest-labs/flux-dev'
        )
      )
    ),
  CONSTRAINT chat_generated_images_scope_lineage_check_v1
    CHECK (
      (
        generation_scope = 'chat'
        AND thread_id IS NOT NULL
        AND source_message_id IS NOT NULL
      )
      OR (
        generation_scope = 'terminal'
        AND thread_id IS NULL
        AND source_message_id IS NULL
      )
    ),
  CONSTRAINT chat_generated_images_prompt_sha256_check_v1
    CHECK (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chat_generated_images_requested_model_bound_v1
    CHECK (
      requested_model IS NULL
      OR (
        length(requested_model) BETWEEN 1 AND 160
        AND requested_model !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT chat_generated_images_provider_request_bound_v1
    CHECK (
      provider_request_id IS NULL
      OR (
        provider_started_at IS NOT NULL
        AND
        length(provider_request_id) BETWEEN 1 AND 200
        AND provider_request_id !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT chat_generated_images_failure_code_bound_v1
    CHECK (
      failure_code IS NULL
      OR failure_code ~ '^[a-z0-9_]{1,80}$'
    ),
  CONSTRAINT chat_generated_images_ready_receipt_check_v1
    CHECK (
      status <> 'ready'
      OR (
        provider_started_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND mime_type IS NOT NULL
        AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
        AND size_bytes IS NOT NULL
        AND size_bytes BETWEEN 1 AND 20971520
        AND width IS NOT NULL
        AND width BETWEEN 1 AND 8192
        AND height IS NOT NULL
        AND height BETWEEN 1 AND 8192
        AND width::bigint * height::bigint <= 40000000
        AND sha256 IS NOT NULL
        AND sha256 ~ '^[0-9a-f]{64}$'
        AND failure_code IS NULL
      )
    ),
  CONSTRAINT chat_generated_images_unknown_receipt_check_v1
    CHECK (
      status <> 'outcome_unknown'
      OR (
        provider_started_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND failure_code IS NOT NULL
      )
  )
);

-- Lock the exact authorization rows while a receipt is inserted or its
-- provider-dispatch marker is claimed. Membership/thread revocation therefore
-- serializes against the claim instead of racing a prior client-side RLS read.
CREATE OR REPLACE FUNCTION public.chat_generated_image_requester_authorized_v1(
  p_user_id uuid,
  p_circle_id uuid,
  p_thread_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  thread_row public.circle_chat_threads%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_circle_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.circle_members AS member
  WHERE member.circle_id = p_circle_id
    AND member.user_id = p_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- A NULL thread is the deliberately isolated OfficeTerminal scope.
  IF p_thread_id IS NULL THEN
    RETURN true;
  END IF;

  SELECT thread.*
  INTO thread_row
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = p_thread_id
    AND thread.circle_id = p_circle_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF thread_row.visibility = 'circle'
     OR thread_row.created_by = p_user_id THEN
    RETURN true;
  END IF;

  PERFORM 1
  FROM public.circle_chat_thread_members AS thread_member
  WHERE thread_member.thread_id = p_thread_id
    AND thread_member.user_id = p_user_id
  FOR KEY SHARE;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_generated_image_requester_authorized_v1(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_chat_generated_image_contract_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  source_row public.messages%ROWTYPE;
  source_thread_circle_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.provider_started_at IS NOT NULL
       OR NEW.provider_request_id IS NOT NULL
       OR NEW.mime_type IS NOT NULL
       OR NEW.size_bytes IS NOT NULL
       OR NEW.width IS NOT NULL
       OR NEW.height IS NOT NULL
       OR NEW.sha256 IS NOT NULL
       OR NEW.failure_code IS NOT NULL
       OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'chat_generated_images: new rows must begin as an unclaimed pending receipt'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.generation_scope = 'chat' THEN
      SELECT message.*
      INTO source_row
      FROM public.messages AS message
      WHERE message.id = NEW.source_message_id;

      IF NOT FOUND
         OR source_row.circle_id IS DISTINCT FROM NEW.circle_id
         OR source_row.thread_id IS DISTINCT FROM NEW.thread_id
         OR source_row.user_id IS DISTINCT FROM NEW.requested_by
         OR COALESCE(source_row.is_bot, false) THEN
        RAISE EXCEPTION 'chat_generated_images: source message lineage mismatch'
          USING ERRCODE = '23514';
      END IF;

      SELECT thread.circle_id
      INTO source_thread_circle_id
      FROM public.circle_chat_threads AS thread
      WHERE thread.id = NEW.thread_id;

      IF NOT FOUND OR source_thread_circle_id IS DISTINCT FROM NEW.circle_id THEN
        RAISE EXCEPTION 'chat_generated_images: source thread lineage mismatch'
          USING ERRCODE = '23514';
      END IF;

      IF NOT public.chat_generated_image_requester_authorized_v1(
        NEW.requested_by,
        NEW.circle_id,
        NEW.thread_id
      ) THEN
        RAISE EXCEPTION 'chat_generated_images: requester cannot access the source thread'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NOT public.chat_generated_image_requester_authorized_v1(
      NEW.requested_by,
      NEW.circle_id,
      NULL
    ) THEN
      RAISE EXCEPTION 'chat_generated_images: terminal requester is not a current circle member'
        USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.generation_scope IS DISTINCT FROM OLD.generation_scope
     OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
     OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
     OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.requested_model IS DISTINCT FROM OLD.requested_model
     OR NEW.prompt_sha256 IS DISTINCT FROM OLD.prompt_sha256
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'chat_generated_images: immutable receipt identity cannot change'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'pending' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'chat_generated_images: terminal receipts are immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('pending', 'ready', 'outcome_unknown') THEN
    RAISE EXCEPTION 'chat_generated_images: invalid receipt transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.provider_started_at IS NULL
     AND NEW.provider_started_at IS NOT NULL THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'chat_generated_images: provider dispatch must be claimed before a terminal transition'
        USING ERRCODE = '23514';
    END IF;

    IF NOT public.chat_generated_image_requester_authorized_v1(
      NEW.requested_by,
      NEW.circle_id,
      NEW.thread_id
    ) THEN
      RAISE EXCEPTION 'chat_generated_images: requester authority retired before provider dispatch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF OLD.provider_started_at IS NOT NULL
     AND NEW.provider_started_at IS DISTINCT FROM OLD.provider_started_at THEN
    RAISE EXCEPTION 'chat_generated_images: provider dispatch marker is immutable once set'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.provider_request_id IS NOT NULL
     AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id THEN
    RAISE EXCEPTION 'chat_generated_images: provider request identity is immutable once set'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'pending' AND (
    NEW.mime_type IS NOT NULL
    OR NEW.size_bytes IS NOT NULL
    OR NEW.width IS NOT NULL
    OR NEW.height IS NOT NULL
    OR NEW.sha256 IS NOT NULL
    OR NEW.failure_code IS NOT NULL
    OR NEW.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'chat_generated_images: pending receipts cannot carry terminal output fields'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_chat_generated_image_contract_v1()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_chat_generated_image_contract_v1
ON public.chat_generated_images;
CREATE TRIGGER enforce_chat_generated_image_contract_v1
BEFORE INSERT OR UPDATE ON public.chat_generated_images
FOR EACH ROW
EXECUTE FUNCTION public.enforce_chat_generated_image_contract_v1();

CREATE OR REPLACE FUNCTION public.chat_generated_image_storage_path_matches_row_v1(
  p_name text,
  p_scope text,
  p_circle_id uuid,
  p_thread_id uuid,
  p_source_message_id uuid,
  p_requested_by uuid,
  p_image_id uuid
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
    AND p_requested_by IS NOT NULL
    AND p_image_id IS NOT NULL
    AND (
      (
        p_scope = 'chat'
        AND p_thread_id IS NOT NULL
        AND p_source_message_id IS NOT NULL
        AND array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 5
        AND split_part(p_name, '/', 1) = p_circle_id::text
        AND split_part(p_name, '/', 2) = p_thread_id::text
        AND split_part(p_name, '/', 3) = p_source_message_id::text
        AND split_part(p_name, '/', 4) = p_requested_by::text
        AND split_part(p_name, '/', 5) = p_image_id::text
      )
      OR (
        p_scope = 'terminal'
        AND p_thread_id IS NULL
        AND p_source_message_id IS NULL
        AND array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 4
        AND split_part(p_name, '/', 1) = p_circle_id::text
        AND split_part(p_name, '/', 2) = '_terminal'
        AND split_part(p_name, '/', 3) = p_requested_by::text
        AND split_part(p_name, '/', 4) = p_image_id::text
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.chat_generated_image_storage_path_matches_row_v1(
  text, text, uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_generated_image_storage_path_matches_row_v1(
  text, text, uuid, uuid, uuid, uuid, uuid
) TO service_role;

ALTER TABLE public.chat_generated_images
  DROP CONSTRAINT IF EXISTS chat_generated_images_storage_path_check_v1;
ALTER TABLE public.chat_generated_images
  ADD CONSTRAINT chat_generated_images_storage_path_check_v1
  CHECK (
    public.chat_generated_image_storage_path_matches_row_v1(
      storage_path,
      generation_scope,
      circle_id,
      thread_id,
      source_message_id,
      requested_by,
      id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS chat_generated_images_storage_path_unique_v1
ON public.chat_generated_images(storage_path);

CREATE UNIQUE INDEX IF NOT EXISTS chat_generated_images_source_message_unique_v1
ON public.chat_generated_images(source_message_id)
WHERE generation_scope = 'chat';

CREATE INDEX IF NOT EXISTS chat_generated_images_circle_created_v1
ON public.chat_generated_images(circle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_generated_images_requester_created_v1
ON public.chat_generated_images(requested_by, created_at DESC);

COMMENT ON TABLE public.chat_generated_images IS
  'Service-owned private image receipts. Chat source_message_id is single-flight and never replays an ambiguous provider call.';
COMMENT ON COLUMN public.chat_generated_images.prompt_sha256 IS
  'SHA-256 binding only; the private user prompt is intentionally not stored in this table.';
COMMENT ON COLUMN public.chat_generated_images.provider_started_at IS
  'Set durably before the first provider request. Later failures are fail-closed outcome_unknown and never auto-replayed.';

ALTER TABLE public.chat_generated_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_generated_images FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_generated_images FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.chat_generated_images TO service_role;

DO $private_generated_image_bucket_identity_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE (
      bucket.id = 'chat-generated-images'
      AND bucket.name <> 'chat-generated-images'
    ) OR (
      bucket.name = 'chat-generated-images'
      AND bucket.id <> 'chat-generated-images'
    )
  ) THEN
    RAISE EXCEPTION 'chat_generated_images: private bucket identity mismatch; inspect before applying'
      USING ERRCODE = '23514';
  END IF;
END
$private_generated_image_bucket_identity_preflight$;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'chat-generated-images',
  'chat-generated-images',
  false,
  20971520,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[];

UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
WHERE id = 'chat-generated-images'
  AND name = 'chat-generated-images';

-- Hosted Supabase owns storage.objects through supabase_storage_admin and
-- keeps RLS enabled. The postgres migration role may manage policies but must
-- not ALTER the platform-owned table.

DROP POLICY IF EXISTS chat_generated_images_authenticated_select_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_generated_images_authenticated_insert_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_generated_images_authenticated_update_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_generated_images_authenticated_delete_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_generated_images_anon_select_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_generated_images_anon_insert_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_generated_images_anon_update_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_generated_images_anon_delete_guard_v1 ON storage.objects;

-- No permissive client policy exists for this bucket. These restrictive
-- guards also prevent an environment-specific broad Storage policy from
-- exposing or mutating the service-owned objects.
CREATE POLICY chat_generated_images_authenticated_select_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (bucket_id <> 'chat-generated-images');

CREATE POLICY chat_generated_images_authenticated_insert_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (bucket_id <> 'chat-generated-images');

CREATE POLICY chat_generated_images_authenticated_update_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (bucket_id <> 'chat-generated-images')
WITH CHECK (bucket_id <> 'chat-generated-images');

CREATE POLICY chat_generated_images_authenticated_delete_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (bucket_id <> 'chat-generated-images');

CREATE POLICY chat_generated_images_anon_select_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO anon
USING (bucket_id <> 'chat-generated-images');

CREATE POLICY chat_generated_images_anon_insert_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO anon
WITH CHECK (bucket_id <> 'chat-generated-images');

CREATE POLICY chat_generated_images_anon_update_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO anon
USING (bucket_id <> 'chat-generated-images')
WITH CHECK (bucket_id <> 'chat-generated-images');

CREATE POLICY chat_generated_images_anon_delete_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO anon
USING (bucket_id <> 'chat-generated-images');

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regclass('public.chat_generated_images') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM storage.buckets AS bucket
      WHERE bucket.id = 'chat-generated-images'
        AND bucket.name = 'chat-generated-images'
        AND bucket.public = false
        AND bucket.file_size_limit = 20971520
        AND bucket.allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_indexes AS index_row
      WHERE index_row.schemaname = 'public'
        AND index_row.indexname = 'chat_generated_images_source_message_unique_v1'
    ) AS chat_generated_images_private_ready;
