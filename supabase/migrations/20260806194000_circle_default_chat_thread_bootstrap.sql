-- A circle is not usable in Chat until its one circle-visible default thread
-- exists. The original thread migration only backfilled circles present on the
-- day it ran; it did not provision future circles. Extend the already-atomic
-- creator-membership trigger so every new circle is immediately chat-ready.

BEGIN;

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
    'auto'
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM anon;
REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM authenticated;

-- Repair every circle created after the historical one-time backfill.
INSERT INTO public.circle_chat_threads (
  circle_id,
  created_by,
  title,
  visibility,
  default_model
)
SELECT
  circle.id,
  circle.created_by,
  'Circle Chat',
  'circle',
  'auto'
FROM public.circles AS circle
WHERE NOT EXISTS (
  SELECT 1
  FROM public.circle_chat_threads AS thread
  WHERE thread.circle_id = circle.id
    AND thread.visibility = 'circle'
);

-- Preserve the pre-thread Chat history for any repaired circle.
UPDATE public.messages AS message
SET thread_id = thread.id
FROM public.circle_chat_threads AS thread
WHERE message.circle_id = thread.circle_id
  AND message.thread_id IS NULL
  AND thread.visibility = 'circle';

COMMIT;
