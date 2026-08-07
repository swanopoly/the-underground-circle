-- Make Claude Sonnet 4.6 the default model for future Chat threads while
-- preserving every existing thread preference, including an explicit `auto`.
--
-- This is intentionally forward-only: it changes defaults and the two thread
-- creation paths, but never rewrites circle_chat_threads rows already chosen
-- by a user or created under an earlier default.

BEGIN;

ALTER TABLE public.circle_chat_threads
  ALTER COLUMN default_model SET DEFAULT 'claude-sonnet-4-6';

CREATE OR REPLACE FUNCTION public.create_private_chat_thread(
  p_circle_id uuid,
  p_title text DEFAULT NULL,
  p_default_model text DEFAULT 'claude-sonnet-4-6'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_user_id uuid;
  v_thread_id uuid;
  v_title text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = p_circle_id
      AND membership.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this circle';
  END IF;

  v_title := coalesce(nullif(pg_catalog.btrim(p_title), ''), 'OpenSwan Session');

  INSERT INTO public.circle_chat_threads (
    circle_id,
    created_by,
    title,
    visibility,
    default_model
  )
  VALUES (
    p_circle_id,
    v_user_id,
    v_title,
    'private',
    coalesce(
      nullif(pg_catalog.btrim(p_default_model), ''),
      'claude-sonnet-4-6'
    )
  )
  RETURNING id INTO v_thread_id;

  INSERT INTO public.circle_chat_thread_members (
    thread_id,
    user_id,
    role,
    added_by
  )
  VALUES (
    v_thread_id,
    v_user_id,
    'owner',
    v_user_id
  )
  ON CONFLICT (thread_id, user_id) DO NOTHING;

  RETURN v_thread_id;
END;
$function$;

-- Preserve the post-lockdown RPC boundary: only authenticated callers and the
-- trusted service role may execute this caller-bound thread creation function.
REVOKE ALL ON FUNCTION public.create_private_chat_thread(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_private_chat_thread(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_private_chat_thread(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.add_creator_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
BEGIN
  INSERT INTO public.circle_members (circle_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'creator')
  ON CONFLICT (circle_id, user_id)
  DO UPDATE SET role = 'creator';

  INSERT INTO public.circle_chat_threads (
    circle_id,
    created_by,
    title,
    visibility,
    default_model
  )
  VALUES (
    NEW.id,
    NEW.created_by,
    'Circle Chat',
    'circle',
    'claude-sonnet-4-6'
  );

  RETURN NEW;
END;
$function$;

-- Trigger-only function: browser roles must not be able to invoke it as RPC.
REVOKE ALL ON FUNCTION public.add_creator_as_member()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_creator_as_member()
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
