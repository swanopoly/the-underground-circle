-- Circle-global idle-behavior reservations.
--
-- Browser schedulers must claim through this RPC before producing any behavior
-- side effect. The conditional UPSERT is the single serialization point across
-- tabs, devices, and circle members; callers never receive direct table DML.

BEGIN;

-- Forward-compatible preference validator repair for databases that already
-- applied the original §45 before sharedChatOptIn was introduced. This exact
-- definition replaces the existing function in place, so its table constraint
-- and patch RPC observe the new optional boolean without rebuilding either.
CREATE OR REPLACE FUNCTION public.validate_office_user_preferences_v1(
  p_preferences jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
DECLARE
  preference_entry record;
  nested_entry record;
  behavior_entry record;
  state_key text;
  numeric_value numeric;
  entry_count integer;
  text_value text;
BEGIN
  IF jsonb_typeof(p_preferences) <> 'object'
     OR octet_length(p_preferences::text) > 131072
     OR public.office_preferences_contains_secret_key_v1(p_preferences) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_preferences) AS preference_key
    WHERE preference_key NOT IN (
      'agentNames',
      'appearances',
      'whiteboardNotes',
      'budgetConfig',
      'idleConfig',
      'agentFilterMode',
      'telegramMetadata'
    )
  ) THEN
    RETURN false;
  END IF;

  FOR preference_entry IN SELECT key, value FROM jsonb_each(p_preferences)
  LOOP
    CASE preference_entry.key
      WHEN 'agentNames' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count > 128 THEN RETURN false; END IF;
        FOR nested_entry IN SELECT key, value FROM jsonb_each(preference_entry.value)
        LOOP
          IF length(nested_entry.key) NOT BETWEEN 1 AND 240
             OR octet_length(nested_entry.key) > 960
             OR jsonb_typeof(nested_entry.value) <> 'string' THEN
            RETURN false;
          END IF;
          text_value := nested_entry.value #>> '{}';
          IF length(btrim(text_value)) NOT BETWEEN 1 AND 80
             OR octet_length(text_value) > 320 THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'appearances' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count > 128 THEN RETURN false; END IF;
        FOR nested_entry IN SELECT key, value FROM jsonb_each(preference_entry.value)
        LOOP
          IF length(nested_entry.key) NOT BETWEEN 1 AND 240
             OR octet_length(nested_entry.key) > 960
             OR jsonb_typeof(nested_entry.value) <> 'object' THEN
            RETURN false;
          END IF;
          SELECT count(*) INTO entry_count FROM jsonb_object_keys(nested_entry.value);
          IF entry_count <> 15
             OR EXISTS (
               SELECT 1 FROM jsonb_object_keys(nested_entry.value) AS appearance_key
               WHERE appearance_key NOT IN (
                 'skinTone', 'hairStyle', 'hairColor', 'shirtColor', 'pantsColor',
                 'shoeColor', 'accessory', 'hat', 'expression', 'backItem',
                 'eyeColor', 'facialHair', 'pet', 'aura', 'handItem'
               )
             ) THEN
            RETURN false;
          END IF;
          FOREACH state_key IN ARRAY ARRAY[
            'skinTone', 'hairStyle', 'hairColor', 'shirtColor', 'pantsColor',
            'shoeColor', 'accessory', 'hat', 'expression', 'backItem',
            'eyeColor', 'facialHair', 'pet', 'aura', 'handItem'
          ]
          LOOP
            IF jsonb_typeof(nested_entry.value -> state_key) <> 'string' THEN
              RETURN false;
            END IF;
          END LOOP;
          FOREACH state_key IN ARRAY ARRAY[
            'skinTone', 'hairColor', 'shirtColor', 'pantsColor', 'shoeColor', 'eyeColor'
          ]
          LOOP
            IF (nested_entry.value ->> state_key) !~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$' THEN
              RETURN false;
            END IF;
          END LOOP;
          IF (nested_entry.value ->> 'hairStyle') NOT IN (
               'flat', 'spiky', 'mohawk', 'long', 'bald', 'cap', 'curly',
               'ponytail', 'buzzcut', 'afro', 'undercut', 'pigtails'
             )
             OR (nested_entry.value ->> 'accessory') NOT IN (
               'none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie',
               'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing',
               'visor_shades', 'gas_mask'
             )
             OR (nested_entry.value ->> 'hat') NOT IN (
               'none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns',
               'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet',
               'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'
             )
             OR (nested_entry.value ->> 'expression') NOT IN (
               'neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry',
               'surprised', 'smirk', 'crying'
             )
             OR (nested_entry.value ->> 'backItem') NOT IN (
               'none', 'cape', 'backpack', 'wings', 'jetpack', 'shield',
               'sword', 'quiver', 'crab_shell', 'tentacles', 'rocket',
               'scroll', 'boombox'
             )
             OR (nested_entry.value ->> 'facialHair') NOT IN (
               'none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu',
               'sideburns', 'soul_patch'
             )
             OR (nested_entry.value ->> 'pet') NOT IN (
               'none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab',
               'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones', 'swan'
             )
             OR (nested_entry.value ->> 'aura') NOT IN (
               'none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow',
               'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'
             )
             OR (nested_entry.value ->> 'handItem') NOT IN (
               'none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand',
               'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'
             ) THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'whiteboardNotes' THEN
        IF jsonb_typeof(preference_entry.value) <> 'array'
           OR jsonb_array_length(preference_entry.value) > 8 THEN
          RETURN false;
        END IF;
        FOR nested_entry IN SELECT value FROM jsonb_array_elements(preference_entry.value)
        LOOP
          IF jsonb_typeof(nested_entry.value) <> 'string' THEN RETURN false; END IF;
          text_value := nested_entry.value #>> '{}';
          IF length(btrim(text_value)) NOT BETWEEN 1 AND 80
             OR octet_length(text_value) > 320 THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'budgetConfig' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object'
           OR jsonb_typeof(preference_entry.value -> 'enabled') <> 'boolean' THEN
          RETURN false;
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS budget_key
          WHERE budget_key NOT IN ('enabled', 'daily', 'weekly', 'monthly', 'hardLimit')
        ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'hardLimit'
           AND jsonb_typeof(preference_entry.value -> 'hardLimit') <> 'boolean' THEN
          RETURN false;
        END IF;
        FOREACH state_key IN ARRAY ARRAY['daily', 'weekly', 'monthly']
        LOOP
          IF preference_entry.value ? state_key THEN
            IF jsonb_typeof(preference_entry.value -> state_key) <> 'number' THEN
              RETURN false;
            END IF;
            numeric_value := (preference_entry.value ->> state_key)::numeric;
            IF numeric_value <= 0 OR numeric_value > 1000000 THEN RETURN false; END IF;
          END IF;
        END LOOP;

      WHEN 'idleConfig' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object'
           OR jsonb_typeof(preference_entry.value -> 'masterEnabled') <> 'boolean'
           OR jsonb_typeof(preference_entry.value -> 'behaviors') <> 'object' THEN
          RETURN false;
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS idle_key
          WHERE idle_key NOT IN ('masterEnabled', 'behaviors', 'sharedChatOptIn')
        ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'sharedChatOptIn'
           AND jsonb_typeof(preference_entry.value -> 'sharedChatOptIn') <> 'boolean' THEN
          RETURN false;
        END IF;
        SELECT count(*) INTO entry_count
        FROM jsonb_object_keys(preference_entry.value -> 'behaviors');
        IF entry_count > 64 THEN RETURN false; END IF;
        FOR behavior_entry IN
          SELECT key, value FROM jsonb_each(preference_entry.value -> 'behaviors')
        LOOP
          IF length(behavior_entry.key) NOT BETWEEN 1 AND 80
             OR octet_length(behavior_entry.key) > 320
             OR jsonb_typeof(behavior_entry.value) <> 'object'
             OR jsonb_typeof(behavior_entry.value -> 'enabled') <> 'boolean'
             OR jsonb_typeof(behavior_entry.value -> 'cooldownMinutes') <> 'number'
             OR NOT (behavior_entry.value ? 'lastRanAt') THEN
            RETURN false;
          END IF;
          IF EXISTS (
            SELECT 1 FROM jsonb_object_keys(behavior_entry.value) AS behavior_key
            WHERE behavior_key NOT IN ('enabled', 'cooldownMinutes', 'lastRanAt')
          ) THEN
            RETURN false;
          END IF;
          numeric_value := (behavior_entry.value ->> 'cooldownMinutes')::numeric;
          IF numeric_value <> trunc(numeric_value)
             OR numeric_value < 1
             OR numeric_value > 10080 THEN
            RETURN false;
          END IF;
          IF jsonb_typeof(behavior_entry.value -> 'lastRanAt') = 'string' THEN
            text_value := behavior_entry.value ->> 'lastRanAt';
            IF length(text_value) > 40
               OR text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
              RETURN false;
            END IF;
          ELSIF jsonb_typeof(behavior_entry.value -> 'lastRanAt') <> 'null' THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'agentFilterMode' THEN
        IF jsonb_typeof(preference_entry.value) <> 'string'
           OR (preference_entry.value #>> '{}') NOT IN ('all', 'mine', 'active', 'bonded') THEN
          RETURN false;
        END IF;

      WHEN 'telegramMetadata' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count NOT BETWEEN 1 AND 2
           OR EXISTS (
             SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS telegram_key
             WHERE telegram_key NOT IN ('chatId', 'botName')
           ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'chatId' THEN
          IF jsonb_typeof(preference_entry.value -> 'chatId') <> 'string'
             OR (preference_entry.value ->> 'chatId') !~ '^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,64})$' THEN
            RETURN false;
          END IF;
        END IF;
        IF preference_entry.value ? 'botName' THEN
          IF jsonb_typeof(preference_entry.value -> 'botName') <> 'string'
             OR (preference_entry.value ->> 'botName') !~ '^[A-Za-z0-9_]{1,64}$' THEN
            RETURN false;
          END IF;
        END IF;

      ELSE
        RETURN false;
    END CASE;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_office_user_preferences_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.circle_idle_behavior_claims (
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  behavior_id text NOT NULL,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL,
  next_eligible_at timestamptz NOT NULL,
  PRIMARY KEY (circle_id, behavior_id)
);

ALTER TABLE public.circle_idle_behavior_claims
  DROP CONSTRAINT IF EXISTS circle_idle_behavior_claims_behavior_id_valid;
ALTER TABLE public.circle_idle_behavior_claims
  ADD CONSTRAINT circle_idle_behavior_claims_behavior_id_valid
  CHECK (
    behavior_id IN (
      'streak_guardian',
      'stale_task_detector',
      'circle_pulse_monitor',
      'knowledge_curator',
      'memory_digest',
      'morning_briefing',
      'weekly_retro',
      'goal_pace_tracker',
      'codebase_scanner',
      'dependency_health',
      'cost_efficiency_report'
    )
  );

ALTER TABLE public.circle_idle_behavior_claims
  DROP CONSTRAINT IF EXISTS circle_idle_behavior_claims_window_valid;
ALTER TABLE public.circle_idle_behavior_claims
  ADD CONSTRAINT circle_idle_behavior_claims_window_valid
  CHECK (
    next_eligible_at > claimed_at
    AND next_eligible_at <= claimed_at + interval '7 days'
  );

ALTER TABLE public.circle_idle_behavior_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_idle_behavior_claims FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.circle_idle_behavior_claims
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_idle_behavior_run_v1(
  p_circle_id uuid,
  p_behavior_id text,
  p_cooldown_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_server_now timestamptz;
  v_effective_cooldown_minutes integer;
  v_claimed_at timestamptz;
  v_next_eligible_at timestamptz;
  v_affected_rows integer := 0;
  v_claimed boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_circle_id IS NULL THEN
    RAISE EXCEPTION 'circle_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_behavior_id IS NULL OR p_behavior_id NOT IN (
    'streak_guardian',
    'stale_task_detector',
    'circle_pulse_monitor',
    'knowledge_curator',
    'memory_digest',
    'morning_briefing',
    'weekly_retro',
    'goal_pace_tracker',
    'codebase_scanner',
    'dependency_health',
    'cost_efficiency_report'
  ) THEN
    RAISE EXCEPTION 'idle_behavior_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF p_cooldown_minutes IS NULL OR p_cooldown_minutes NOT BETWEEN 1 AND 10080 THEN
    RAISE EXCEPTION 'idle_behavior_cooldown_out_of_bounds' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = v_actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'circle_membership_required' USING ERRCODE = '42501';
  END IF;

  v_effective_cooldown_minutes := CASE
    WHEN p_behavior_id IN (
      'streak_guardian',
      'circle_pulse_monitor',
      'morning_briefing',
      'weekly_retro',
      'goal_pace_tracker'
    )
      THEN greatest(p_cooldown_minutes, 1440)
    ELSE p_cooldown_minutes
  END;
  v_server_now := clock_timestamp();

  INSERT INTO public.circle_idle_behavior_claims AS current_claim (
    circle_id,
    behavior_id,
    claimed_by,
    claimed_at,
    next_eligible_at
  )
  VALUES (
    p_circle_id,
    p_behavior_id,
    v_actor_id,
    v_server_now,
    v_server_now + make_interval(mins => v_effective_cooldown_minutes)
  )
  ON CONFLICT (circle_id, behavior_id) DO UPDATE
  SET claimed_by = EXCLUDED.claimed_by,
      claimed_at = EXCLUDED.claimed_at,
      next_eligible_at = EXCLUDED.next_eligible_at
  WHERE current_claim.next_eligible_at <= EXCLUDED.claimed_at
  RETURNING current_claim.claimed_at, current_claim.next_eligible_at
    INTO v_claimed_at, v_next_eligible_at;

  GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
  v_claimed := v_affected_rows = 1;

  IF NOT v_claimed THEN
    SELECT claim.claimed_at, claim.next_eligible_at
      INTO v_claimed_at, v_next_eligible_at
    FROM public.circle_idle_behavior_claims AS claim
    WHERE claim.circle_id = p_circle_id
      AND claim.behavior_id = p_behavior_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'idle_behavior_claim_state_unavailable' USING ERRCODE = '40001';
    END IF;
    v_effective_cooldown_minutes := greatest(
      1,
      least(
        10080,
        ceil(extract(epoch FROM (v_next_eligible_at - v_claimed_at)) / 60)::integer
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'claimed', v_claimed,
    'behaviorId', p_behavior_id,
    'effectiveCooldownMinutes', v_effective_cooldown_minutes,
    'claimedAt', to_jsonb(v_claimed_at),
    'nextEligibleAt', to_jsonb(v_next_eligible_at)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer)
  TO authenticated;

COMMENT ON TABLE public.circle_idle_behavior_claims IS
  'Circle-global cooldown reservations claimed atomically before idle behavior side effects.';
COMMENT ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer) IS
  'Atomically reserves one allowlisted idle behavior for an authenticated circle member.';

COMMIT;

NOTIFY pgrst, 'reload schema';
