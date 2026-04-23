-- ═══════════════════════════════════════════════════════════════════════════
-- Notion-inspired features for Underground Circle (2026-04-17)
--
-- Tier 1: mission history (page versioning equivalent)
-- Tier 2: rich block editor storage, unified @mentions
--
-- All additive — existing queries keep working.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- MISSION REVISIONS — snapshot every edit to circle_missions for history/diff
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mission_revisions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      uuid         NOT NULL REFERENCES circle_missions(id) ON DELETE CASCADE,
  editor_id       uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  title           text         NOT NULL,
  description     text,
  status          text,
  deadline        timestamptz,
  brief_blocks    jsonb,
  change_summary  text,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mission_revisions_mission
  ON mission_revisions (mission_id, created_at DESC);

ALTER TABLE mission_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mission_revisions_read" ON mission_revisions;
CREATE POLICY "mission_revisions_read"
  ON mission_revisions FOR SELECT
  USING (
    mission_id IN (
      SELECT cm.id FROM circle_missions cm
      INNER JOIN circle_members m ON m.circle_id = cm.circle_id
      WHERE m.user_id = auth.uid()
    )
  );

-- Auto-snapshot trigger: fires AFTER UPDATE on circle_missions, records the
-- previous row into mission_revisions. Lets the UI show "who changed what
-- when" without any client-side bookkeeping.
CREATE OR REPLACE FUNCTION snapshot_mission_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_summary text;
BEGIN
  -- Build a tiny human-readable diff summary. Keeps the UI fast (no need to
  -- load two revisions to know what changed).
  v_summary := '';
  IF OLD.title       IS DISTINCT FROM NEW.title        THEN v_summary := v_summary || 'title '; END IF;
  IF OLD.description IS DISTINCT FROM NEW.description  THEN v_summary := v_summary || 'description '; END IF;
  IF OLD.status      IS DISTINCT FROM NEW.status       THEN v_summary := v_summary || 'status '; END IF;
  IF OLD.deadline    IS DISTINCT FROM NEW.deadline     THEN v_summary := v_summary || 'deadline '; END IF;
  -- brief_blocks column added below; tolerate absence with jsonb exception.
  BEGIN
    IF OLD.brief_blocks IS DISTINCT FROM NEW.brief_blocks THEN v_summary := v_summary || 'brief '; END IF;
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;

  IF length(trim(v_summary)) = 0 THEN
    RETURN NEW;  -- nothing meaningful changed (updated_at bump only)
  END IF;

  INSERT INTO mission_revisions (
    mission_id, editor_id, title, description, status, deadline, brief_blocks, change_summary
  ) VALUES (
    OLD.id,
    auth.uid(),
    OLD.title,
    OLD.description,
    OLD.status,
    OLD.deadline,
    CASE WHEN to_jsonb(OLD) ? 'brief_blocks' THEN (to_jsonb(OLD) -> 'brief_blocks') ELSE NULL END,
    trim(v_summary)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_snapshot_mission_revision ON circle_missions;
CREATE TRIGGER trg_snapshot_mission_revision
AFTER UPDATE ON circle_missions
FOR EACH ROW EXECUTE FUNCTION snapshot_mission_revision();


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK EDITOR STORAGE — blocks as a JSONB array on missions
-- Backwards compatible: existing missions keep using `description`. New or
-- edited missions can populate `brief_blocks` with structured blocks:
--
--   [
--     { "id": "abc", "type": "heading", "level": 1, "text": "Plan" },
--     { "id": "def", "type": "paragraph", "text": "..." },
--     { "id": "ghi", "type": "checkbox", "text": "Ship MVP", "checked": false },
--     { "id": "jkl", "type": "code", "language": "ts", "text": "..." },
--     { "id": "mno", "type": "callout", "icon": "!", "text": "..." }
--   ]
--
-- The frontend renders either field; mutation UIs prefer brief_blocks.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE circle_missions
  ADD COLUMN IF NOT EXISTS brief_blocks jsonb DEFAULT '[]'::jsonb;


-- ───────────────────────────────────────────────────────────────────────────
-- UNIFIED MENTIONS — @member, @mission, @task references
-- Stored normalized so backlinks work ("which missions reference @alice")
-- without parsing every chat message.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mentions (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id        uuid         NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  source_type      text         NOT NULL CHECK (source_type IN ('message', 'mission', 'mission_task', 'proof', 'comment')),
  source_id        uuid         NOT NULL,
  target_type      text         NOT NULL CHECK (target_type IN ('user', 'mission', 'mission_task')),
  target_id        uuid         NOT NULL,
  author_id        uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mentions_source
  ON mentions (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_mentions_target
  ON mentions (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentions_circle
  ON mentions (circle_id, created_at DESC);

ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentions_read_circle_members" ON mentions;
CREATE POLICY "mentions_read_circle_members"
  ON mentions FOR SELECT
  USING (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "mentions_insert_circle_members" ON mentions;
CREATE POLICY "mentions_insert_circle_members"
  ON mentions FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

-- Search RPC for the @ picker UI. Returns members, missions, and open tasks
-- matching the query string in a single call — avoids 3 round trips per
-- keystroke as the user types.
CREATE OR REPLACE FUNCTION search_mention_candidates(
  p_circle_id uuid,
  p_query     text,
  p_limit     integer DEFAULT 8
) RETURNS TABLE (
  kind        text,
  id          uuid,
  label       text,
  sublabel    text
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH q AS (SELECT lower(coalesce(nullif(trim(p_query), ''), '')) AS qs)
  SELECT * FROM (
    -- Members
    SELECT
      'user'::text AS kind,
      p.id,
      COALESCE(p.display_name, p.username, 'Member') AS label,
      COALESCE(p.username, '') AS sublabel
    FROM profiles p
    INNER JOIN circle_members cm ON cm.user_id = p.id
    CROSS JOIN q
    WHERE cm.circle_id = p_circle_id
      AND (q.qs = '' OR lower(COALESCE(p.display_name, '')) LIKE '%' || q.qs || '%' OR lower(COALESCE(p.username, '')) LIKE '%' || q.qs || '%')

    UNION ALL

    -- Active missions
    SELECT
      'mission'::text AS kind,
      m.id,
      m.title AS label,
      m.status AS sublabel
    FROM circle_missions m
    CROSS JOIN q
    WHERE m.circle_id = p_circle_id
      AND m.status IN ('active', 'draft')
      AND (q.qs = '' OR lower(m.title) LIKE '%' || q.qs || '%')

    UNION ALL

    -- Open tasks (via mission_tasks)
    SELECT
      'mission_task'::text AS kind,
      t.id,
      t.title AS label,
      t.status AS sublabel
    FROM mission_tasks t
    INNER JOIN circle_missions m ON m.id = t.mission_id
    CROSS JOIN q
    WHERE m.circle_id = p_circle_id
      AND t.status IN ('pending', 'in_progress')
      AND (q.qs = '' OR lower(t.title) LIKE '%' || q.qs || '%')
  ) candidates
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION search_mention_candidates(uuid, text, integer) TO authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- PostgREST schema reload
-- ───────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
