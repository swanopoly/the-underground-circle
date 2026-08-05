-- ═══════════════════════════════════════════════════════════════════════════════
-- agent_runs.agent_id — durable run→agent linkage (Office plan item O6)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   Everything the Office claims about an agent's work — the Building-Now board,
--   per-agent live ops, the accountability line, the desk plaque, cost roll-up —
--   currently attributes a run to an agent by MATCHING NAMES and identity aliases
--   (`officeRunLookup.buildOfficeAgentRunLookupKeys` against `delegated_to` /
--   a "Name: " title prefix / the surface label, plus whatever subject identity
--   the writer happened to stash in `metadata`). A miss silently attributes an
--   agent's failures to nobody; a false hit attributes them to the wrong agent.
--   Neither is acceptable for an accountability product.
--
-- WHY TEXT AND NOT A uuid FK
--   The Office roster is deliberately a MIX: published `circle_office_agents`
--   rows (uuid ids) AND session-derived agents from local bridges, which have no
--   DB row at all and whose canonical id is a runtime subject key. A uuid FK
--   would cover only the published half and leave the bridge agents — the ones
--   doing most of the work — back on name matching. `text` lets ONE column carry
--   the canonical subject key for every agent kind.
--
--   The application already expects exactly these semantics:
--   `AgentRun.agent_id?: string` (agentRunSystem.ts) and
--   `deriveRunSubjectIdentity` (officeOpsBoard.ts) already reads `run.agent_id`
--   as a subject-key fallback. This migration promotes it from a value the code
--   hoped for into a real, indexed column.
--
-- SAFETY
--   Purely additive and idempotent. Nullable with no default, no backfill, no
--   constraint: every existing row stays valid and every existing query keeps
--   working. Old rows simply keep resolving through the name-matching fallback,
--   which is unchanged. The client tolerates the column being absent (it omits
--   `agent_id` and retries on a missing-column error), so applying this is safe
--   in either order relative to a deploy.
--
--   Mirrored into docs/RUN_THIS_SQL.sql as §25.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS agent_id text;

COMMENT ON COLUMN agent_runs.agent_id IS
  'Canonical agent runtime subject key (agentRuntimeSubject.subjectKey) — or the '
  'circle_office_agents uuid for published agents. Durable replacement for '
  'name-based run→agent attribution. NULL on rows written before Office plan O6.';

-- Per-circle agent history: the accountability index, per-agent cost roll-up and
-- the live board all scan a circle's recent runs and group by agent.
CREATE INDEX IF NOT EXISTS idx_agent_runs_circle_agent
  ON agent_runs(circle_id, agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

-- PostgREST must be told about the new column or the client keeps 400ing.
NOTIFY pgrst, 'reload schema';
