-- ─── Proof Validations ──────────────────────────────────────────────────────
-- Persists circle members' votes on each other's proof-of-work check-ins.
-- Previously the UI in CheckInScreen.handleValidateProof awarded 5 XP for a
-- click but threw the vote away — the check_ins.proof JSONB's
-- validation_score / validation_count values were never updated. This table
-- backs those numbers with real data.

CREATE TABLE IF NOT EXISTS proof_validations (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id   uuid         NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  validator_id  uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_valid      boolean      NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (check_in_id, validator_id)
);

CREATE INDEX IF NOT EXISTS idx_proof_validations_check_in
  ON proof_validations (check_in_id);

CREATE INDEX IF NOT EXISTS idx_proof_validations_validator
  ON proof_validations (validator_id, created_at DESC);

-- ─── Recompute aggregate on check_ins.proof after every vote ────────────────
-- Materializes validation_score (valid - invalid) and validation_count (total)
-- inside the check_ins.proof JSONB so existing UI code keeps working without
-- changing its read path.

CREATE OR REPLACE FUNCTION update_proof_validation_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_check_in_id   uuid;
  v_valid_count   integer;
  v_invalid_count integer;
  v_total         integer;
BEGIN
  v_check_in_id := COALESCE(NEW.check_in_id, OLD.check_in_id);

  SELECT
    COUNT(*) FILTER (WHERE is_valid),
    COUNT(*) FILTER (WHERE NOT is_valid),
    COUNT(*)
    INTO v_valid_count, v_invalid_count, v_total
  FROM proof_validations
  WHERE check_in_id = v_check_in_id;

  UPDATE check_ins
  SET proof = COALESCE(proof, '{}'::jsonb) || jsonb_build_object(
    'validation_score', v_valid_count - v_invalid_count,
    'validation_count', v_total
  )
  WHERE id = v_check_in_id;

  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_proof_validation_counts ON proof_validations;
CREATE TRIGGER trg_proof_validation_counts
AFTER INSERT OR UPDATE OR DELETE ON proof_validations
FOR EACH ROW EXECUTE FUNCTION update_proof_validation_counts();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE proof_validations ENABLE ROW LEVEL SECURITY;

-- Read: any circle member can see votes on check-ins in circles they belong to.
DROP POLICY IF EXISTS "proof_validations_read_circle" ON proof_validations;
CREATE POLICY "proof_validations_read_circle"
  ON proof_validations FOR SELECT
  USING (
    check_in_id IN (
      SELECT ci.id
      FROM check_ins ci
      INNER JOIN circle_members cm ON cm.circle_id = ci.circle_id
      WHERE cm.user_id = auth.uid()
    )
  );

-- Insert: users can vote on other members' check-ins in their own circles,
-- but cannot vote on their own check-ins.
DROP POLICY IF EXISTS "proof_validations_insert_own_vote" ON proof_validations;
CREATE POLICY "proof_validations_insert_own_vote"
  ON proof_validations FOR INSERT
  WITH CHECK (
    validator_id = auth.uid()
    AND check_in_id IN (
      SELECT ci.id
      FROM check_ins ci
      INNER JOIN circle_members cm ON cm.circle_id = ci.circle_id
      WHERE cm.user_id = auth.uid()
        AND ci.user_id <> auth.uid()
    )
  );

-- Votes are immutable: no UPDATE policy (can't change your vote), no DELETE
-- policy (can't retract). If we later want "change your mind" UX, add a
-- policy here and keep the UNIQUE constraint for one-vote-per-user.

NOTIFY pgrst, 'reload schema';
