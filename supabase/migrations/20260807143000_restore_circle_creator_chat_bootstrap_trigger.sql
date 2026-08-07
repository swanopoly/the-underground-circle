-- Restore the atomic circle bootstrap hook. The trigger function is already
-- canonical and current; this migration repairs environments where the
-- function survived but its AFTER INSERT trigger was never installed.

BEGIN;

DROP TRIGGER IF EXISTS trg_add_creator_as_member ON public.circles;
CREATE TRIGGER trg_add_creator_as_member
AFTER INSERT ON public.circles
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_as_member();

-- Repair only absent creator memberships. Existing memberships and roles are
-- intentionally left untouched.
INSERT INTO public.circle_members (circle_id, user_id, role)
SELECT circle.id, circle.created_by, 'creator'
FROM public.circles AS circle
WHERE circle.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = circle.id
      AND membership.user_id = circle.created_by
  )
ON CONFLICT (circle_id, user_id) DO NOTHING;

-- Repair only circles that have no circle-visible Chat thread. The partial
-- unique index on circle_id WHERE visibility='circle' is the race-safe final
-- guard if another transaction repairs the same circle concurrently.
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
  'claude-sonnet-4-6'
FROM public.circles AS circle
WHERE circle.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.circle_id = circle.id
      AND thread.visibility = 'circle'
  )
ON CONFLICT DO NOTHING;

COMMIT;
