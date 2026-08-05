-- ─────────────────────────────────────────────────────────────────────────
-- agent_run_events: add the MISSING RLS policy. APPLIED 2026-07-10.
--
-- Root cause of the empty-flywheel finding (P63): the table has RLS
-- ENABLED but had ZERO policies, so every client-side event insert (the
-- P11 trace wiring in openswanSessionRuntime.onEvent, agentRunPersistence
-- writeEvent, subagent ledgers) was silently rejected — the writers are
-- fire-and-forget by design, so nothing ever surfaced. agent_runs rows
-- accumulated (40) while agent_run_events stayed at 0 in production.
--
-- Policy mirrors agent_runs' `agent_runs_circle_member` (verified live:
-- USING circle_id IN (SELECT circle_id FROM circle_members WHERE
-- user_id = auth.uid())), scoped through the parent run. FOR ALL so
-- circle members can write their runs' events and read them back
-- (run-trace panels); service_role bypasses RLS as always.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS agent_run_events_circle_member ON agent_run_events;
CREATE POLICY agent_run_events_circle_member ON agent_run_events
  FOR ALL
  USING (
    run_id IN (
      SELECT r.id FROM agent_runs r
      WHERE r.circle_id IN (
        SELECT circle_members.circle_id
        FROM circle_members
        WHERE circle_members.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    run_id IN (
      SELECT r.id FROM agent_runs r
      WHERE r.circle_id IN (
        SELECT circle_members.circle_id
        FROM circle_members
        WHERE circle_members.user_id = auth.uid()
      )
    )
  );

-- Event inserts and trace reads filter by run_id constantly; the policy
-- subquery also leans on it.
CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_id
  ON agent_run_events (run_id);
