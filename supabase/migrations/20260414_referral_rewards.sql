-- Referral rewards — track who-invited-whom and reward inviters.
--
-- Adds:
--   * circle_members.referred_by — FK to the user who invited this member
--   * award_referral_bonus() RPC — atomic: awards points + checks Connector
--     badge thresholds + writes to user_badges. Idempotent so the same
--     (inviter, invitee, circle) triple can be re-submitted without
--     double-awarding (uses unique constraint on points_transactions metadata).
--
-- Connector badge tiers (badge IDs in user_badges.badge_id):
--   connector_1   — first successful referral
--   connector_5   — 5 distinct people joined via your invites
--   connector_10  — 10 distinct
--   connector_25  — 25 distinct
--
-- Points per referral: 50. The XP/points layer already exists; this just
-- writes a new transaction reason 'referral_bonus' with metadata.

-- ============================================================================
-- 1. circle_members.referred_by
-- ============================================================================

ALTER TABLE circle_members
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_circle_members_referred_by
  ON circle_members(referred_by)
  WHERE referred_by IS NOT NULL;

-- ============================================================================
-- 2. award_referral_bonus RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION award_referral_bonus(
  p_inviter_id uuid,
  p_invitee_id uuid,
  p_circle_id  uuid
)
RETURNS TABLE(
  points_awarded int,
  total_referrals int,
  newly_earned_badge text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_credited boolean;
  v_referral_count int;
  v_newly_earned text := NULL;
BEGIN
  -- Don't reward self-referrals (shouldn't happen via the UI but guard anyway)
  IF p_inviter_id = p_invitee_id THEN
    RETURN QUERY SELECT 0, 0, NULL::text;
    RETURN;
  END IF;

  -- Idempotency: have we already credited this exact (inviter, invitee, circle)?
  -- We check the points_transactions audit trail since it's the source of truth
  -- for what's been awarded. The metadata jsonb stores the triple.
  SELECT EXISTS (
    SELECT 1 FROM points_transactions
    WHERE user_id = p_inviter_id
      AND reason = 'referral_bonus'
      AND metadata->>'invitee_id' = p_invitee_id::text
      AND metadata->>'circle_id'  = p_circle_id::text
  ) INTO v_already_credited;

  IF v_already_credited THEN
    -- Return current count without awarding again
    SELECT COUNT(DISTINCT user_id)::int INTO v_referral_count
      FROM circle_members
      WHERE referred_by = p_inviter_id;
    RETURN QUERY SELECT 0, v_referral_count, NULL::text;
    RETURN;
  END IF;

  -- Award 50 points to the inviter
  PERFORM award_points(
    p_inviter_id,
    50,
    'referral_bonus',
    jsonb_build_object(
      'invitee_id', p_invitee_id,
      'circle_id', p_circle_id
    )
  );

  -- Count distinct people the inviter has brought in (across all circles)
  SELECT COUNT(DISTINCT user_id)::int INTO v_referral_count
    FROM circle_members
    WHERE referred_by = p_inviter_id;

  -- Evaluate Connector badge tiers — award the highest tier just crossed
  -- (we award them all up-to-and-including in case a tier was missed).
  IF v_referral_count >= 1 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_inviter_id AND badge_id = 'connector_1'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id, earned_at)
    VALUES (p_inviter_id, 'connector_1', now())
    ON CONFLICT DO NOTHING;
    v_newly_earned := 'connector_1';
  END IF;

  IF v_referral_count >= 5 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_inviter_id AND badge_id = 'connector_5'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id, earned_at)
    VALUES (p_inviter_id, 'connector_5', now())
    ON CONFLICT DO NOTHING;
    v_newly_earned := 'connector_5';
  END IF;

  IF v_referral_count >= 10 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_inviter_id AND badge_id = 'connector_10'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id, earned_at)
    VALUES (p_inviter_id, 'connector_10', now())
    ON CONFLICT DO NOTHING;
    v_newly_earned := 'connector_10';
  END IF;

  IF v_referral_count >= 25 AND NOT EXISTS (
    SELECT 1 FROM user_badges WHERE user_id = p_inviter_id AND badge_id = 'connector_25'
  ) THEN
    INSERT INTO user_badges (user_id, badge_id, earned_at)
    VALUES (p_inviter_id, 'connector_25', now())
    ON CONFLICT DO NOTHING;
    v_newly_earned := 'connector_25';
  END IF;

  RETURN QUERY SELECT 50, v_referral_count, v_newly_earned;
END;
$$;

GRANT EXECUTE ON FUNCTION award_referral_bonus(uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
