-- Mid-run confirmation prompts for Computer Use tasks. When the agent is
-- about to do something risky (purchase, submit, delete, log in to a
-- sensitive site), it calls the `ask_user` tool. The edge function
-- inserts a row here and polls until the client writes a decision.
--
-- This lets us pause the agent mid-stream without a bidirectional WS
-- channel — both sides just touch this table.

CREATE TABLE IF NOT EXISTS computer_use_confirmations (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid         NOT NULL REFERENCES computer_use_runs(id) ON DELETE CASCADE,
  question    text         NOT NULL,
  /** Optional choice list. Agent can offer ["Yes, continue", "No, stop",
   *  "Use a different approach"]. */
  options     jsonb,
  /** Optional context hint Claude writes — "you're on the checkout page
   *  for a $2,499 camera". */
  context     text,
  /** Null = pending, set when user decides. Stored as the label (or
   *  "__approve__" / "__reject__" for binary). */
  choice      text,
  user_id     uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cu_confirmations_run
  ON computer_use_confirmations (run_id, created_at DESC);

ALTER TABLE computer_use_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cu_conf_read_members" ON computer_use_confirmations;
CREATE POLICY "cu_conf_read_members"
  ON computer_use_confirmations FOR SELECT
  USING (
    run_id IN (
      SELECT id FROM computer_use_runs
      WHERE circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "cu_conf_member_resolve" ON computer_use_confirmations;
CREATE POLICY "cu_conf_member_resolve"
  ON computer_use_confirmations FOR UPDATE
  USING (
    run_id IN (
      SELECT id FROM computer_use_runs
      WHERE circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    run_id IN (
      SELECT id FROM computer_use_runs
      WHERE circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
