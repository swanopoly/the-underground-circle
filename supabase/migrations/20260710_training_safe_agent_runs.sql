-- ─────────────────────────────────────────────────────────────────────────
-- Training-safe views for agent tool-use runs.
-- P63 BlackSwan tool-trace flywheel — PENDING APPLY
--
-- Purpose: let the BlackSwan training exporters
-- (scripts/blackswan-llm/export_training_data.py and
--  scripts/blackswan-llm/export_tool_traces.py) read real agent tool-use
-- trajectories (`agent_runs` + `agent_run_events`) through the same
-- privacy/opt-out gate as every other `training_safe_*` view instead of
-- the raw tables.
--
-- Opt-out mechanism mirrored from 20260312_training_privacy.sql
-- (profiles.training_opt_out boolean + training_opt_out_fields text[],
--  join on the owning user — agent_runs.user_id is NOT NULL, so the
--  inner-join form used by training_safe_messages applies). The events
-- view gates through its parent view exactly like
-- training_safe_mission_tasks → training_safe_missions in
-- 20260506c_training_safe_wave2_tables.sql. `security_invoker = true`
-- follows 20260325_security_linter_fixes.sql (the exporter's service
-- role bypasses RLS; authenticated readers keep base-table RLS).
--
-- Schema notes (verified against src/lib/agentRunSystem.ts,
-- src/lib/agentRunPersistence.ts, 20260408_unified_agent_runs.sql and
-- docs/RUN_THIS_SQL.sql §9):
--   * agent_run_events columns are (id, run_id, kind, payload, at) — the
--     timestamp column is `at`, NOT created_at (drift verified against
--     production 2026-07-02 by export_tool_traces.py). Aliased to
--     created_at here so exporters order uniformly with other tables.
--   * Event kinds exposed are the flywheel set persisted by
--     agentRunPersistence.onEvent; payload shapes:
--       tool_call_start     {iteration, tool, tool_use_id, input}
--       tool_call_result    {iteration, tool, tool_use_id, ok,
--                            duration_ms, error?}
--       final_response      {iteration, preview(≤400 chars), length}
--       solver_consultation {iteration, reason}
--       turn_end            {iteration, stop_reason, usage}
-- ─────────────────────────────────────────────────────────────────────────

-- Completed runs only: training wants finished trajectories. Explicit
-- column list (deliberately tighter than the wave-2 SELECT-* precedent):
-- user_id / room_id / chat_session_id / parent_run_id are identifiers
-- training does not need, and context_snapshot / metadata / token columns
-- can carry payloads. circle_id stays — the existing safe views keep
-- circle-scoped ids and the exporters group by it.
CREATE OR REPLACE VIEW training_safe_agent_runs
  WITH (security_invoker = true) AS
  SELECT
    r.id,
    r.circle_id,
    r.surface,
    r.title,
    r.goal,
    r.mode,
    r.model,
    r.provider,
    r.status,
    r.created_at,
    r.completed_at
  FROM agent_runs r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.status = 'completed'
    AND p.training_opt_out = false
    AND NOT ('agent_runs' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

-- Events inherit the owner's opt-out from the parent run. Only flywheel
-- event kinds are exposed; turn_end rides along for round-boundary/usage
-- context. `at` aliased to created_at (see header).
CREATE OR REPLACE VIEW training_safe_agent_run_events
  WITH (security_invoker = true) AS
  SELECT
    e.run_id,
    e.kind,
    e.payload,
    e.at AS created_at
  FROM agent_run_events e
  JOIN training_safe_agent_runs r ON r.id = e.run_id
  WHERE e.kind IN (
    'tool_call_start',
    'tool_call_result',
    'final_response',
    'solver_consultation',
    'turn_end'
  );

-- Grants match 20260506c_training_safe_wave2_tables.sql.
GRANT SELECT ON training_safe_agent_runs       TO authenticated, service_role;
GRANT SELECT ON training_safe_agent_run_events TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
