-- Recurring computer-task watches ("check X every day, tell me when it
-- changes") — Phase 6a of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md.
-- One row per watch. The runner picks due rows (active AND next_run_at
-- <= now()), executes the task through the normal computer-use pipeline,
-- diffs findings against last_findings via src/lib/computerRunDiff.ts,
-- and posts an update to thread_id per notify_on.
--
-- Row shape is mirrored 1:1 by ComputerTaskScheduleRow in
-- src/lib/computerTaskScheduleModel.ts — keep them in lockstep.
--
-- docs/AGENTS_ROADMAP.md's SQL checklist owns applied-status. This file
-- existing locally is not proof that production has it.

CREATE TABLE IF NOT EXISTS computer_use_schedules (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id         uuid         NOT NULL,
  created_by        uuid,
  -- Read-only monitoring task text, validated + clamped by
  -- validateWatchTask before insert.
  task              text         NOT NULL,
  cadence           text         NOT NULL CHECK (cadence IN ('hourly', 'daily', 'weekly')),
  notify_on         text         NOT NULL DEFAULT 'changes_only' CHECK (notify_on IN ('always', 'changes_only')),
  -- Chat thread the watch reports into; null = the circle's main chat.
  thread_id         uuid,
  active            boolean      NOT NULL DEFAULT true,
  last_run_at       timestamptz,
  -- Structured findings from the last run, kept so computerRunDiff can
  -- compare the next run against them.
  last_findings     jsonb,
  last_diff_summary text,
  next_run_at       timestamptz  NOT NULL,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cu_schedules_due
  ON computer_use_schedules (circle_id, active, next_run_at);

ALTER TABLE computer_use_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cu_sched_read_members" ON computer_use_schedules;
CREATE POLICY "cu_sched_read_members"
  ON computer_use_schedules FOR SELECT
  USING (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "cu_sched_member_insert" ON computer_use_schedules;
CREATE POLICY "cu_sched_member_insert"
  ON computer_use_schedules FOR INSERT
  WITH CHECK (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "cu_sched_member_update" ON computer_use_schedules;
CREATE POLICY "cu_sched_member_update"
  ON computer_use_schedules FOR UPDATE
  USING (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "cu_sched_member_delete" ON computer_use_schedules;
CREATE POLICY "cu_sched_member_delete"
  ON computer_use_schedules FOR DELETE
  USING (
    circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
