-- ─────────────────────────────────────────────────────────────────────────
-- Fix XP System — resolves schema mismatch and sync issues
--
-- Problems:
--   1. user_xp table uses `id` as PK but all code references `user_id`
--   2. sync_points_to_xp() sets total_xp=0 instead of syncing actual value
--   3. award_xp() and gamification queries all use user_id column
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Add user_id column to user_xp (mirrors the `id` PK)
ALTER TABLE user_xp ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2. Backfill user_id from id for existing rows
UPDATE user_xp SET user_id = id WHERE user_id IS NULL;

-- 3. Add unique constraint on user_id (required for ON CONFLICT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_xp_user_id_key'
  ) THEN
    ALTER TABLE user_xp ADD CONSTRAINT user_xp_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 4. Auto-populate user_id = id on future inserts via the PK path
CREATE OR REPLACE FUNCTION user_xp_set_user_id()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_xp_set_user_id ON user_xp;
CREATE TRIGGER trg_user_xp_set_user_id
  BEFORE INSERT ON user_xp
  FOR EACH ROW EXECUTE FUNCTION user_xp_set_user_id();


-- 5. Fix award_xp() — use user_id column (now exists) with correct conflict
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
  -- Atomic upsert using user_id (has unique constraint)
  INSERT INTO user_xp (id, user_id, total_xp, level, title, updated_at)
  VALUES (p_user_id, p_user_id, p_amount, 1, 'Recruit', now())
  ON CONFLICT (user_id) DO UPDATE
    SET total_xp   = user_xp.total_xp + p_amount,
        updated_at = now();

  -- Log the event
  INSERT INTO xp_events (user_id, xp_amount, event_type, metadata)
  VALUES (p_user_id, p_amount, p_event_type, p_metadata);

  -- Recalculate level & title
  SELECT ux.total_xp INTO v_total FROM user_xp ux WHERE ux.user_id = p_user_id;
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

  UPDATE user_xp SET level = v_level, title = v_title WHERE user_xp.user_id = p_user_id;

  RETURN QUERY SELECT v_total, v_level;
END;
$$;

GRANT EXECUTE ON FUNCTION award_xp(uuid, int, text, jsonb) TO authenticated;


-- 6. Fix sync_points_to_xp() — properly sync lifetime_points → total_xp
CREATE OR REPLACE FUNCTION sync_points_to_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level  int;
  v_title  text;
BEGIN
  -- Calculate level from the synced lifetime_points
  v_level := LEAST(FLOOR(SQRT(NEW.lifetime_points::float / 50))::int + 1, 100);
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

  INSERT INTO user_xp (id, user_id, total_xp, grind_karma, level, title, updated_at)
  VALUES (NEW.user_id, NEW.user_id, NEW.lifetime_points, NEW.lifetime_points, v_level, v_title, now())
  ON CONFLICT (user_id) DO UPDATE
    SET total_xp    = NEW.lifetime_points,
        grind_karma = NEW.lifetime_points,
        level       = v_level,
        title       = v_title,
        updated_at  = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_points_to_xp ON user_points;
CREATE TRIGGER trg_sync_points_to_xp
  AFTER INSERT OR UPDATE ON user_points
  FOR EACH ROW EXECUTE FUNCTION sync_points_to_xp();
