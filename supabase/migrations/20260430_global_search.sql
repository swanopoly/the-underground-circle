-- ═══════════════════════════════════════════════════════════════════════════
-- Circle-scoped global search across missions, tasks, goals, proofs,
-- messages. Uses pg_trgm for fast LIKE-based substring matching so the
-- query stays snappy as tables grow.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes: make "%query%" LIKE patterns index-backed.
-- Without these, Postgres does a full table scan for every search.
CREATE INDEX IF NOT EXISTS idx_circle_missions_title_trgm
  ON circle_missions USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_circle_missions_desc_trgm
  ON circle_missions USING gin (description gin_trgm_ops)
  WHERE description IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mission_tasks_title_trgm
  ON mission_tasks USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mission_tasks_desc_trgm
  ON mission_tasks USING gin (description gin_trgm_ops)
  WHERE description IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm
  ON tasks USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tasks_desc_trgm
  ON tasks USING gin (description gin_trgm_ops)
  WHERE description IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_name_trgm
  ON goals USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_goals_desc_trgm
  ON goals USING gin (description gin_trgm_ops)
  WHERE description IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proof_of_work_title_trgm
  ON proof_of_work USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON messages USING gin (content gin_trgm_ops)
  WHERE content IS NOT NULL;

-- ─── Search RPC ──────────────────────────────────────────────────────────────
-- Unified search across every content type, scoped to a single circle.
-- Explicit membership guard replaces RLS (SECURITY DEFINER is faster for
-- this many UNION ALL branches than re-checking each row's RLS policy).

CREATE OR REPLACE FUNCTION search_circle_content(
  p_circle_id uuid,
  p_query     text,
  p_limit     integer DEFAULT 20
) RETURNS TABLE (
  kind        text,
  id          uuid,
  title       text,
  subtitle    text,
  created_at  timestamptz
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pattern text;
  v_q_trim  text;
BEGIN
  v_q_trim := trim(COALESCE(p_query, ''));
  IF length(v_q_trim) < 2 THEN
    RETURN;
  END IF;

  -- Membership guard — replaces RLS for this one function.
  IF NOT EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = p_circle_id AND user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  v_pattern := '%' || lower(v_q_trim) || '%';

  RETURN QUERY
  SELECT * FROM (
    SELECT
      'mission'::text                 AS kind,
      m.id                            AS id,
      m.title                         AS title,
      m.status                        AS subtitle,
      m.created_at                    AS created_at
    FROM circle_missions m
    WHERE m.circle_id = p_circle_id
      AND (lower(m.title) LIKE v_pattern
           OR lower(COALESCE(m.description, '')) LIKE v_pattern)

    UNION ALL

    SELECT
      'mission_task'::text,
      mt.id,
      mt.title,
      mt.status,
      mt.created_at
    FROM mission_tasks mt
    INNER JOIN circle_missions m ON m.id = mt.mission_id
    WHERE m.circle_id = p_circle_id
      AND (lower(mt.title) LIKE v_pattern
           OR lower(COALESCE(mt.description, '')) LIKE v_pattern)

    UNION ALL

    SELECT
      'task'::text,
      t.id,
      t.title,
      t.status,
      t.created_at
    FROM tasks t
    WHERE t.circle_id = p_circle_id
      AND (lower(t.title) LIKE v_pattern
           OR lower(COALESCE(t.description, '')) LIKE v_pattern)

    UNION ALL

    SELECT
      'goal'::text,
      g.id,
      g.name,
      g.status,
      g.created_at
    FROM goals g
    WHERE g.circle_id = p_circle_id
      AND (lower(g.name) LIKE v_pattern
           OR lower(COALESCE(g.description, '')) LIKE v_pattern)

    UNION ALL

    SELECT
      'proof'::text,
      p.id,
      p.title,
      p.pow_type,
      p.created_at
    FROM proof_of_work p
    WHERE p.circle_id = p_circle_id
      AND lower(p.title) LIKE v_pattern

    UNION ALL

    SELECT
      'message'::text,
      msg.id,
      substring(msg.content FROM 1 FOR 120),
      'message'::text,
      msg.created_at
    FROM messages msg
    WHERE msg.circle_id = p_circle_id
      AND msg.content IS NOT NULL
      AND lower(msg.content) LIKE v_pattern
  ) AS hits
  ORDER BY created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
END;
$$;

GRANT EXECUTE ON FUNCTION search_circle_content(uuid, text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
