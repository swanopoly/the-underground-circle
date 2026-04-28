-- Memory Inspect & Control — Phase 5 of the Agent Memory God Plan.
-- Wires per-message audit linkage so the citation pill ("Used N memories")
-- can show which memories shaped a specific assistant reply.
--
-- Design choices:
--   * Two FK columns on memory_access_log: message_id (the user's
--     triggering message) and assistant_message_id (the reply that
--     consumed the memories). The pill renders against the assistant
--     reply; the trigger ID is kept for diagnostics.
--   * Both nullable + indexed only when populated — pre-existing rows
--     stay valid, indexes don't bloat with NULLs.
--   * No new columns on memory_entries — reinforcement is already
--     handled via memory_evaluations (recordMemoryFeedback with
--     action='confirmed_helpful' / 'not_helpful').
--
-- Spec: docs/superpowers/specs/2026-04-28-memory-inspect-control-design.md

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Add per-message linkage columns
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE memory_access_log
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES messages(id) ON DELETE CASCADE;

ALTER TABLE memory_access_log
  ADD COLUMN IF NOT EXISTS assistant_message_id uuid REFERENCES messages(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Indexes — partial on the populated rows only
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_memory_access_log_message
  ON memory_access_log(message_id) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_access_log_assistant_message
  ON memory_access_log(assistant_message_id) WHERE assistant_message_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. RPC — fetch the cited memories for a given assistant reply
-- ═══════════════════════════════════════════════════════════════════════════════
-- Returns rows the caller can already see via memory_entries RLS — no bypass.
-- Joined with memory_entries so the UI gets title/kind/scope/importance in
-- a single round-trip instead of N queries.

CREATE OR REPLACE FUNCTION get_memory_citations(p_assistant_message_id uuid)
RETURNS TABLE (
  memory_id uuid,
  title text,
  content text,
  memory_kind text,
  scope text,
  importance numeric,
  pinned boolean,
  reason text,
  surface text,
  accessed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    m.id            AS memory_id,
    m.title,
    m.content,
    m.memory_kind,
    m.scope,
    m.importance,
    COALESCE(m.pinned, false) AS pinned,
    a.reason,
    a.surface,
    a.created_at    AS accessed_at
  FROM memory_access_log a
  JOIN memory_entries m ON m.id = a.memory_id
  WHERE a.assistant_message_id = p_assistant_message_id
    AND a.reason = 'retrieval'
  ORDER BY m.importance DESC NULLS LAST, a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_memory_citations(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
