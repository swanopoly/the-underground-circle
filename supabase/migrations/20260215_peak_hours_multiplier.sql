-- Peak Hours Multiplier System
-- Engagement hook for time-sensitive XP bonuses

-- Update award_xp function to support peak hours multipliers
CREATE OR REPLACE FUNCTION award_xp(
  p_user_id uuid,
  p_amount int,
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_xp int;
  v_level int;
  v_title text;
  v_final_amount int;
  v_multiplier numeric DEFAULT 1.0;
  v_current_hour int;
  v_current_minute int;
  v_current_time time;
BEGIN
  -- Calculate peak hours multiplier for specific event types
  IF p_event_type IN ('check_in', 'task_complete', 'challenge_progress') THEN
    v_current_time := CURRENT_TIME;
    v_current_hour := EXTRACT(hour from v_current_time);
    v_current_minute := EXTRACT(minute from v_current_time);
    
    -- Morning Boost: 7:00-9:00 AM = 2x multiplier
    IF (v_current_hour = 7) OR (v_current_hour = 8) OR (v_current_hour = 9 AND v_current_minute = 0) THEN
      v_multiplier := 2.0;
    -- Lunch Break Boost: 12:00-1:00 PM = 1.5x multiplier  
    ELSIF (v_current_hour = 12) OR (v_current_hour = 13 AND v_current_minute = 0) THEN
      v_multiplier := 1.5;
    -- Evening Grind: 7:00-9:00 PM = 2x multiplier
    ELSIF (v_current_hour = 19) OR (v_current_hour = 20) OR (v_current_hour = 21 AND v_current_minute = 0) THEN
      v_multiplier := 2.0;
    END IF;
  END IF;
  
  -- Apply multiplier
  v_final_amount := FLOOR(p_amount * v_multiplier);
  
  -- Add multiplier info to metadata
  p_metadata := p_metadata || jsonb_build_object(
    'peak_hours_multiplier', v_multiplier,
    'base_amount', p_amount,
    'bonus_amount', v_final_amount - p_amount
  );

  -- Insert xp event with final amount
  INSERT INTO xp_events (user_id, event_type, xp_amount, metadata)
  VALUES (p_user_id, p_event_type, v_final_amount, p_metadata);

  -- Upsert user_xp
  INSERT INTO user_xp (id, total_xp, level, title, updated_at)
  VALUES (p_user_id, v_final_amount, 1, 'Recruit', now())
  ON CONFLICT (id) DO UPDATE SET
    total_xp = user_xp.total_xp + v_final_amount,
    updated_at = now();

  -- Update karma
  IF p_event_type IN ('check_in', 'task_complete', 'streak_bonus', 'daily_login', 'challenge_progress') THEN
    UPDATE user_xp SET grind_karma = grind_karma + v_final_amount WHERE id = p_user_id;
  ELSIF p_event_type IN ('upvote_received', 'circle_join', 'circle_create') THEN
    UPDATE user_xp SET social_karma = social_karma + v_final_amount WHERE id = p_user_id;
  END IF;

  -- Get new total
  SELECT total_xp INTO v_total_xp FROM user_xp WHERE id = p_user_id;

  -- Calculate level: floor(sqrt(total_xp / 50)) + 1, capped at 100
  v_level := LEAST(FLOOR(SQRT(v_total_xp::float / 50)) + 1, 100);

  -- Calculate title based on level
  v_title := CASE
    WHEN v_level >= 50 THEN 'Underground King'
    WHEN v_level >= 40 THEN 'Underground Boss'
    WHEN v_level >= 30 THEN 'Legend'
    WHEN v_level >= 25 THEN 'OG'
    WHEN v_level >= 20 THEN 'Elite'
    WHEN v_level >= 15 THEN 'Veteran'
    WHEN v_level >= 10 THEN 'Hustler'
    WHEN v_level >= 5 THEN 'Grinder'
    ELSE 'Recruit'
  END;

  -- Update user_xp with level/title
  UPDATE user_xp SET level = v_level, title = v_title WHERE id = p_user_id;

  -- Update denormalized profiles columns
  UPDATE profiles SET xp = v_total_xp, level = v_level, title = v_title WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'total_xp', v_total_xp, 
    'level', v_level, 
    'title', v_title,
    'multiplier', v_multiplier,
    'xp_awarded', v_final_amount
  );
END;
$$;