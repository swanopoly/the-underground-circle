-- Canonical message-attachment linkage integrity.
--
-- The original message_attachments UPDATE policy checked only the attachment
-- owner. That allowed an authenticated owner to rewrite attachment identity or
-- attach a staged row to any guessed message UUID. Keep the existing direct
-- Chat UPDATE API, but make it a database-enforced compare-and-set:
--
--   * only the owner, while still a circle member, may update;
--   * authenticated INSERT always creates an unlinked staged row;
--   * durable attachment identity/content fields are immutable;
--   * message_id may move only from NULL to one exact, owner-authored,
--     non-bot message in the same circle and thread (or remain unchanged for a
--     safe retry);
--   * ocr_text remains mutable for the owner-side OCR path;
--   * trusted service-role/Postgres maintenance remains available.

BEGIN;

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- Deterministically quarantine legacy links that cannot prove the exact
-- attachment/message scope. There is no safe message target to infer for such
-- a row, so returning it to the staged (NULL) state is the only non-forging
-- repair. Valid same-owner, same-circle, same-thread user-message links remain.
UPDATE public.message_attachments AS attachment
SET message_id = NULL
WHERE attachment.message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS target_message
    WHERE target_message.id = attachment.message_id
      AND target_message.circle_id = attachment.circle_id
      AND target_message.thread_id IS NOT DISTINCT FROM attachment.thread_id
      AND target_message.user_id = attachment.user_id
      AND COALESCE(target_message.is_bot, false) = false
  );

-- This predicate intentionally runs with caller privileges. Its messages query
-- therefore preserves canonical message/thread RLS instead of becoming a
-- SECURITY DEFINER existence oracle. The explicit owner equality also keeps a
-- caller from probing another user's message identity through this function.
CREATE OR REPLACE FUNCTION public.message_attachment_link_target_is_valid_v1(
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
    p_message_id IS NULL
    OR (
      auth.uid() IS NOT NULL
      AND p_user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.messages AS target_message
        WHERE target_message.id = p_message_id
          AND target_message.circle_id = p_circle_id
          AND target_message.thread_id IS NOT DISTINCT FROM p_thread_id
          AND target_message.user_id = p_user_id
          AND COALESCE(target_message.is_bot, false) = false
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_link_target_is_valid_v1(uuid, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_link_target_is_valid_v1(uuid, uuid, uuid, uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_authenticated_message_attachment_update_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  trusted_writer boolean :=
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin', 'service_role');
BEGIN
  IF trusted_writer THEN
    RETURN NEW;
  END IF;

  IF actor_id IS NULL OR OLD.user_id IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'message_attachment_owner_required'
      USING ERRCODE = '42501';
  END IF;

  -- message_id and ocr_text are the only authenticated-client mutable fields.
  -- Comparing the remaining row as jsonb also fails closed if a future column
  -- is added without an explicit decision here.
  IF (to_jsonb(NEW) - ARRAY['message_id', 'ocr_text'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['message_id', 'ocr_text']) THEN
    RAISE EXCEPTION 'message_attachment_identity_immutable'
      USING ERRCODE = '42501';
  END IF;

  -- A linked attachment is immutable. Repeating the same message_id is an
  -- idempotent retry; changing it or returning it to NULL is rejected.
  IF OLD.message_id IS NOT NULL
     AND NEW.message_id IS DISTINCT FROM OLD.message_id THEN
    RAISE EXCEPTION 'message_attachment_relink_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.message_attachment_link_target_is_valid_v1(
    NEW.message_id,
    NEW.circle_id,
    NEW.thread_id,
    NEW.user_id
  ) THEN
    RAISE EXCEPTION 'message_attachment_target_mismatch'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_authenticated_message_attachment_update_v1
ON public.message_attachments;
CREATE TRIGGER trg_guard_authenticated_message_attachment_update_v1
BEFORE UPDATE ON public.message_attachments
FOR EACH ROW EXECUTE FUNCTION public.guard_authenticated_message_attachment_update_v1();

REVOKE ALL ON FUNCTION public.guard_authenticated_message_attachment_update_v1()
FROM PUBLIC, anon, authenticated;

-- Permissive policies are ORed, so every historical INSERT, UPDATE, or FOR ALL
-- policy must be removed before installing the canonical staged-insert and
-- owner/scope-update policies. SELECT and DELETE policies are intentionally
-- left unchanged in this focused migration.
DO $policy_convergence$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
      AND cmd IN ('INSERT', 'UPDATE', 'ALL')
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.message_attachments',
      policy_row.policyname
    );
  END LOOP;
END;
$policy_convergence$;

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
);

CREATE POLICY message_attachments_update_owner_exact_link_v1
ON public.message_attachments
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
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
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
);

-- Keep the current PostgREST `.update({ message_id })` and owner OCR paths
-- compatible. RLS plus the BEFORE trigger narrow this table-level grant to the
-- two explicitly mutable fields above.
REVOKE ALL ON TABLE public.message_attachments FROM PUBLIC, anon;
GRANT INSERT, UPDATE ON TABLE public.message_attachments TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- §39 readiness (catalog and stored-row integrity only; this does not prove a
-- live authenticated Chat upload/link round trip).
SELECT
  to_regclass('public.message_attachments') IS NOT NULL
    AS message_attachments_ready,
  to_regprocedure('public.message_attachment_link_target_is_valid_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
    AS attachment_link_validator_ready,
  to_regprocedure('public.guard_authenticated_message_attachment_update_v1()') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.message_attachments'::regclass
        AND trigger_row.tgname = 'trg_guard_authenticated_message_attachment_update_v1'
        AND trigger_row.tgenabled <> 'D'
        AND NOT trigger_row.tgisinternal
    ) AS attachment_update_guard_ready,
  (
    SELECT count(*) = 1
      AND bool_and(policyname = 'message_attachments_insert_owner_staged_v1')
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
      AND cmd = 'INSERT'
  ) AS attachment_insert_policy_converged,
  (
    SELECT count(*) = 1
      AND bool_and(policyname = 'message_attachments_update_owner_exact_link_v1')
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
      AND cmd IN ('UPDATE', 'ALL')
  ) AS attachment_update_policy_converged,
  NOT EXISTS (
    SELECT 1
    FROM public.message_attachments AS attachment
    WHERE attachment.message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.messages AS target_message
        WHERE target_message.id = attachment.message_id
          AND target_message.circle_id = attachment.circle_id
          AND target_message.thread_id IS NOT DISTINCT FROM attachment.thread_id
          AND target_message.user_id = attachment.user_id
          AND COALESCE(target_message.is_bot, false) = false
      )
  ) AS stored_attachment_links_valid,
  has_table_privilege('authenticated', 'public.message_attachments', 'UPDATE')
    AND has_table_privilege('authenticated', 'public.message_attachments', 'INSERT')
    AS authenticated_attachment_write_grants_ready;
