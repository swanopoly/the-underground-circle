-- ─────────────────────────────────────────────────────────────────────────
-- Atomic XP / Points award functions
--
-- Problem: the old JS code did SELECT → calculate → UPSERT in separate calls.
-- Two concurrent agent turns could race and one would overwrite the other,
-- silently dropping XP. Fix: single atomic SQL increment per call.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Atomic award_points — replaces the JS read+write dance in rewardService.ts
--    Returns the new lifetime total so the caller can check badge thresholds.
CREATE OR REPLACE FUNCTION award_points(
  p_user_id  uuid,
  p_amount   int,
  p_reason   text,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS TABLE(new_lifetime bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Atomic upsert: if row doesn't exist create it, otherwise ADD (not replace)
  INSERT INTO user_points (user_id, total_points, lifetime_points, updated_at)
  VALUES (p_user_id, p_amount, p_amount, now())
  ON CONFLICT (user_id) DO UPDATE
    SET total_points    = user_points.total_points    + EXCLUDED.total_points,
        lifetime_points = user_points.lifetime_points + EXCLUDED.lifetime_points,
        updated_at      = now();

  -- Audit trail
  INSERT INTO points_transactions (user_id, points, reason, metadata)
  VALUES (p_user_id, p_amount, p_reason, p_metadata);

  RETURN QUERY
    SELECT up.lifetime_points FROM user_points up WHERE up.user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION award_points(uuid, int, text, jsonb) TO authenticated;


-- 2. Atomic award_xp — same fix for the user_xp table (gamification.ts)
--    The existing award_xp RPC uses INSERT...ON CONFLICT DO UPDATE which IS
--    atomic, but it recalculates level/title in PL/pgSQL. We just make sure
--    the function is idempotent and won't silently fail.
--    Re-create it here with SECURITY DEFINER so anon failures can't drop XP.
CREATE OR REPLACE FUNCTION award_xp(
  p_user_id   uuid,
  p_amount    int,
  p_event_type text,
  p_metadata  jsonb DEFAULT '{}'
)
RETURNS TABLE(total_xp bigint, level int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total  bigint;
  v_level  int;
  v_title  text;
BEGIN
  -- Atomic upsert
  INSERT INTO user_xp (id, total_xp, level, title, updated_at)
  VALUES (p_user_id, p_amount, 1, 'Recruit', now())
  ON CONFLICT (id) DO UPDATE
    SET total_xp   = user_xp.total_xp + p_amount,
        updated_at = now();

  -- Log the event
  INSERT INTO xp_events (user_id, xp_amount, event_type, metadata)
  VALUES (p_user_id, p_amount, p_event_type, p_metadata);

  -- Recalculate level & title
  SELECT ux.total_xp INTO v_total FROM user_xp ux WHERE ux.id = p_user_id;
  v_level := LEAST(FLOOR(SQRT(v_total::float / 50))::int + 1, 100);
  v_title := CASE
    WHEN v_level >= 50 THEN 'Underground King'
    WHEN v_level >= 40 THEN 'Underground Boss'
    WHEN v_level >= 30 THEN 'Legend'
    WHEN v_level >= 25 THEN 'OG'
    WHEN v_level >= 20 THEN 'Elite'
    WHEN v_level >= 15 THEN 'Veteran'
    WHEN v_level >= 10 THEN 'Hustler'
    WHEN v_level >= 5  THEN 'Grinder'
    ELSE 'Recruit'
  END;

  UPDATE user_xp SET level = v_level, title = v_title WHERE id = p_user_id;

  RETURN QUERY SELECT v_total, v_level;
END;
$$;

GRANT EXECUTE ON FUNCTION award_xp(uuid, int, text, jsonb) TO authenticated;


-- 3. Cross-sync trigger: whenever user_points gets updated, mirror the
--    lifetime_points into user_xp.grind_karma so leaderboards stay consistent.
CREATE OR REPLACE FUNCTION sync_points_to_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_xp (id, total_xp, grind_karma, level, title, updated_at)
  VALUES (NEW.user_id, 0, NEW.lifetime_points, 1, 'Recruit', now())
  ON CONFLICT (id) DO UPDATE
    SET grind_karma = NEW.lifetime_points,
        updated_at  = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_points_to_xp ON user_points;
CREATE TRIGGER trg_sync_points_to_xp
  AFTER INSERT OR UPDATE ON user_points
  FOR EACH ROW EXECUTE FUNCTION sync_points_to_xp();
