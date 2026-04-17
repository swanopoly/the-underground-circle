-- Memory Soul Links — Phase 0 of the Agent Memory God Plan.
-- Gives us a structured place to record which SOULs (spirit personas) own
-- or share each memory, the ownership mode, and the router's confidence.
-- Until now, soul routing was hardcoded (scope = preference/instruction →
-- user, else → circle) and `decideSoulMemoryRouting` was imported but never
-- invoked on writes. This migration plus the matching client-side change
-- finally persists the router's output.
--
-- Ownership modes mirror agentSoulMemory.ts::decideSoulMemoryRouting:
--   exclusive    — one SOUL owns this memory
--   shared_multi — 2–3 SOULs share it (one `primary`, rest `shared`)
--   agent_core   — belongs to the agent as a whole (no SOUL link created)
--
-- Roles:
--   primary   — the main owner (one per memory for exclusive/shared_multi)
--   shared    — additional co-owners for shared_multi memories
--   reference — soft link; the memory touches this SOUL's domain but is
--               owned elsewhere (useful for retrieval boosts)

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. The join table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS memory_soul_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  soul_key text NOT NULL,                -- 'soul:architect', 'soul:designer', etc.
  role text NOT NULL CHECK (role IN ('primary', 'shared', 'reference')),
  ownership_mode text NOT NULL CHECK (ownership_mode IN ('exclusive', 'shared_multi', 'agent_core')),
  confidence numeric(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  rationale text,
  -- Denormalized for RLS speed — we need `circle_id` to enforce the same
  -- visibility rules as memory_entries without a join on every check.
  circle_id uuid REFERENCES circles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (memory_id, soul_key)
);

-- Query paths:
-- 1. "all memories owned by SOUL X in circle Y"   → (soul_key, circle_id)
-- 2. "all SOULs linked to memory M"                → (memory_id)
-- 3. "SOUL-weighted retrieval ranking"             → (soul_key, role) for boost calc
CREATE INDEX IF NOT EXISTS idx_memory_soul_links_soul_circle
  ON memory_soul_links (soul_key, circle_id);
CREATE INDEX IF NOT EXISTS idx_memory_soul_links_memory
  ON memory_soul_links (memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_soul_links_role
  ON memory_soul_links (soul_key, role);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RLS — mirror memory_entries visibility exactly
-- ═══════════════════════════════════════════════════════════════════════════════
-- A user can see/write a soul link iff they can see/write the memory it
-- points to. We can't just say "owner only" because circle_shared memories
-- need their links visible to every circle member.

ALTER TABLE memory_soul_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_soul_links_select ON memory_soul_links;
CREATE POLICY memory_soul_links_select ON memory_soul_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM memory_entries m
    WHERE m.id = memory_soul_links.memory_id
      AND (
        (m.visibility IN ('room_shared','circle_shared','org_shared')
          AND m.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
        OR (m.visibility = 'private' AND m.user_id = auth.uid())
      )
  )
);

DROP POLICY IF EXISTS memory_soul_links_insert ON memory_soul_links;
CREATE POLICY memory_soul_links_insert ON memory_soul_links FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM memory_entries m
    WHERE m.id = memory_soul_links.memory_id
      AND (
        (m.visibility IN ('room_shared','circle_shared','org_shared')
          AND m.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
        OR (m.visibility = 'private' AND m.user_id = auth.uid())
      )
  )
);

DROP POLICY IF EXISTS memory_soul_links_update ON memory_soul_links;
CREATE POLICY memory_soul_links_update ON memory_soul_links FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM memory_entries m
    WHERE m.id = memory_soul_links.memory_id
      AND (
        (m.visibility IN ('room_shared','circle_shared','org_shared')
          AND m.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
        OR (m.visibility = 'private' AND m.user_id = auth.uid())
      )
  )
);

DROP POLICY IF EXISTS memory_soul_links_delete ON memory_soul_links;
CREATE POLICY memory_soul_links_delete ON memory_soul_links FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM memory_entries m
    WHERE m.id = memory_soul_links.memory_id
      AND (
        (m.visibility IN ('room_shared','circle_shared','org_shared')
          AND m.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
        OR (m.visibility = 'private' AND m.user_id = auth.uid())
      )
  )
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Convenience view — flat join for read paths that want SOUL info inline
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW memory_with_souls AS
SELECT
  m.*,
  COALESCE(
    json_agg(
      json_build_object(
        'soul_key', sl.soul_key,
        'role', sl.role,
        'ownership_mode', sl.ownership_mode,
        'confidence', sl.confidence
      )
      ORDER BY CASE sl.role WHEN 'primary' THEN 0 WHEN 'shared' THEN 1 ELSE 2 END
    ) FILTER (WHERE sl.id IS NOT NULL),
    '[]'::json
  ) AS soul_links,
  (
    SELECT sl2.soul_key
    FROM memory_soul_links sl2
    WHERE sl2.memory_id = m.id AND sl2.role = 'primary'
    LIMIT 1
  ) AS primary_soul_key
FROM memory_entries m
LEFT JOIN memory_soul_links sl ON sl.memory_id = m.id
GROUP BY m.id;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Observability — quick health view for the plan's memory_health dashboard
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW memory_soul_coverage AS
SELECT
  m.circle_id,
  m.scope,
  m.memory_kind,
  COUNT(*) AS total_memories,
  COUNT(sl.id) FILTER (WHERE sl.role = 'primary') AS with_primary_soul,
  COUNT(DISTINCT sl.soul_key) AS distinct_souls_touched,
  ROUND(
    100.0 * COUNT(DISTINCT sl.memory_id) / NULLIF(COUNT(DISTINCT m.id), 0),
    1
  ) AS percent_routed
FROM memory_entries m
LEFT JOIN memory_soul_links sl ON sl.memory_id = m.id
WHERE m.is_active = true
GROUP BY m.circle_id, m.scope, m.memory_kind;

NOTIFY pgrst, 'reload schema';
