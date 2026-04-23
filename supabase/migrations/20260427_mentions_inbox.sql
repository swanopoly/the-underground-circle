-- ═══════════════════════════════════════════════════════════════════════════
-- Mentions: 'goal' source_type + unread-tracking for a Mentions Inbox
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Extend the source_type CHECK to include 'goal'.
ALTER TABLE mentions
  DROP CONSTRAINT IF EXISTS mentions_source_type_check;
ALTER TABLE mentions
  ADD CONSTRAINT mentions_source_type_check
  CHECK (source_type IN (
    'message', 'mission', 'mission_task', 'proof', 'comment', 'check_in', 'goal'
  ));

-- 2. Track when a user last saw their mentions. A single timestamp column on
--    profiles is enough — the inbox renders unread by comparing each
--    mention's created_at to this value. No extra join per mention.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS mentions_seen_at timestamptz NOT NULL DEFAULT '1970-01-01'::timestamptz;

-- 3. Helper RPC for the Mentions Inbox: returns every mention that targets
--    the current user, newest first. The panel can then display unread
--    counts by comparing against profiles.mentions_seen_at.
--
--    We limit to the last 180 days and cap at 200 rows. That's enough for a
--    busy user's inbox while keeping the RPC cheap.
CREATE OR REPLACE FUNCTION get_my_mentions(
  p_limit integer DEFAULT 100
) RETURNS TABLE (
  id            uuid,
  circle_id     uuid,
  source_type   text,
  source_id     uuid,
  author_id     uuid,
  created_at    timestamptz,
  seen          boolean
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH me AS (
    SELECT auth.uid() AS uid,
           COALESCE(
             (SELECT mentions_seen_at FROM profiles WHERE id = auth.uid()),
             '1970-01-01'::timestamptz
           ) AS seen_at
  )
  SELECT
    m.id,
    m.circle_id,
    m.source_type,
    m.source_id,
    m.author_id,
    m.created_at,
    m.created_at <= me.seen_at AS seen
  FROM mentions m, me
  WHERE m.target_type = 'user'
    AND m.target_id = me.uid
    AND m.created_at > now() - interval '180 days'
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

GRANT EXECUTE ON FUNCTION get_my_mentions(integer) TO authenticated;

-- 4. Unread count for a badge. Cheap — single COUNT with index hit.
CREATE OR REPLACE FUNCTION get_my_mention_unread_count()
RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COUNT(*)::integer FROM mentions m
  WHERE m.target_type = 'user'
    AND m.target_id = auth.uid()
    AND m.created_at > (
      SELECT COALESCE(mentions_seen_at, '1970-01-01'::timestamptz)
      FROM profiles WHERE id = auth.uid()
    )
    AND m.created_at > now() - interval '180 days';
$$;

GRANT EXECUTE ON FUNCTION get_my_mention_unread_count() TO authenticated;

-- 5. Mark-seen helper: bumps mentions_seen_at to now() for the current user.
--    Called when the user opens the Mentions Inbox.
CREATE OR REPLACE FUNCTION mark_my_mentions_seen()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE profiles
  SET mentions_seen_at = now()
  WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION mark_my_mentions_seen() TO authenticated;

NOTIFY pgrst, 'reload schema';
