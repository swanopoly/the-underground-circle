-- Owner-private, circle-scoped Office preferences with atomic patch authority.
--
-- `profiles.office_preferences` is a flat profile blob and profile rows are
-- readable by fellow circle members. It therefore cannot own private Office
-- state or credentials. This migration introduces an exact owner+circle row,
-- limits it to reviewed non-secret fields, and makes one server-side patch RPC
-- the only authenticated mutation surface.

BEGIN;

CREATE OR REPLACE FUNCTION public.office_preferences_contains_secret_key_v1(
  p_value jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
DECLARE
  object_entry record;
  array_entry jsonb;
  normalized_key text;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      FOR object_entry IN SELECT key, value FROM jsonb_each(p_value)
      LOOP
        normalized_key := regexp_replace(lower(object_entry.key), '[^a-z0-9]', '', 'g');
        IF lower(object_entry.key) IN ('__proto__', 'prototype', 'constructor')
           OR normalized_key ~ '(password|passwd|secret|token|apikey|accesskey|privatekey|credential|authorization|bearer|cookie|sessionkey|webhook)' THEN
          RETURN true;
        END IF;
        IF public.office_preferences_contains_secret_key_v1(object_entry.value) THEN
          RETURN true;
        END IF;
      END LOOP;
    WHEN 'array' THEN
      FOR array_entry IN SELECT value FROM jsonb_array_elements(p_value)
      LOOP
        IF public.office_preferences_contains_secret_key_v1(array_entry) THEN
          RETURN true;
        END IF;
      END LOOP;
    ELSE
      NULL;
  END CASE;
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.office_preferences_contains_secret_key_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

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
          WHERE idle_key NOT IN ('masterEnabled', 'behaviors')
        ) THEN
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

CREATE TABLE IF NOT EXISTS public.office_user_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, circle_id)
);

ALTER TABLE public.office_user_preferences
  DROP CONSTRAINT IF EXISTS office_user_preferences_document_valid;
ALTER TABLE public.office_user_preferences
  ADD CONSTRAINT office_user_preferences_document_valid
  CHECK (public.validate_office_user_preferences_v1(preferences));

ALTER TABLE public.office_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_user_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_user_preferences_select_own ON public.office_user_preferences;
CREATE POLICY office_user_preferences_select_own
ON public.office_user_preferences
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = office_user_preferences.circle_id
      AND membership.user_id = auth.uid()
  )
);

REVOKE ALL ON TABLE public.office_user_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.office_user_preferences TO authenticated;

CREATE OR REPLACE FUNCTION public.read_my_office_preferences_v1(
  p_circle_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  stored_preferences jsonb;
  stored_revision bigint;
  stored_updated_at timestamptz;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_circle_id IS NULL THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;

  SELECT preferences, revision, updated_at
  INTO stored_preferences, stored_revision, stored_updated_at
  FROM public.office_user_preferences
  WHERE user_id = actor_id
    AND circle_id = p_circle_id;

  RETURN jsonb_build_object(
    'preferences', coalesce(stored_preferences, '{}'::jsonb),
    'revision', coalesce(stored_revision, 0),
    'updatedAt', to_jsonb(stored_updated_at)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.patch_my_office_preferences_v1(
  p_circle_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  patch_entry record;
  next_preferences jsonb;
  accepted_revision bigint;
  accepted_updated_at timestamptz;
  patch_key_count integer;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_circle_id IS NULL THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL
     OR jsonb_typeof(p_patch) <> 'object'
     OR octet_length(p_patch::text) > 131072 THEN
    RAISE EXCEPTION 'invalid_office_preferences_patch' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO patch_key_count FROM jsonb_object_keys(p_patch);
  IF patch_key_count NOT BETWEEN 1 AND 7
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(p_patch) AS patch_key
       WHERE patch_key NOT IN (
         'agentNames',
         'appearances',
         'whiteboardNotes',
         'budgetConfig',
         'idleConfig',
         'agentFilterMode',
         'telegramMetadata'
       )
     )
     OR public.office_preferences_contains_secret_key_v1(p_patch) THEN
    RAISE EXCEPTION 'invalid_office_preferences_patch' USING ERRCODE = '22023';
  END IF;

  -- Establish and lock the exact owner+circle row. A concurrent first writer
  -- waits on the same unique key, then reads the winner before applying its own
  -- disjoint top-level patch; no client read/merge race is possible.
  INSERT INTO public.office_user_preferences(user_id, circle_id)
  VALUES (actor_id, p_circle_id)
  ON CONFLICT (user_id, circle_id) DO NOTHING;

  SELECT preferences
  INTO next_preferences
  FROM public.office_user_preferences
  WHERE user_id = actor_id
    AND circle_id = p_circle_id
  FOR UPDATE;

  IF next_preferences IS NULL THEN
    RAISE EXCEPTION 'office_preferences_row_unavailable' USING ERRCODE = '55000';
  END IF;

  FOR patch_entry IN SELECT key, value FROM jsonb_each(p_patch)
  LOOP
    next_preferences := next_preferences - patch_entry.key;
    IF patch_entry.value <> 'null'::jsonb THEN
      next_preferences := next_preferences || jsonb_build_object(patch_entry.key, patch_entry.value);
    END IF;
  END LOOP;

  IF NOT public.validate_office_user_preferences_v1(next_preferences)
     OR octet_length(next_preferences::text) > 131072 THEN
    RAISE EXCEPTION 'invalid_office_preferences_document' USING ERRCODE = '22023';
  END IF;

  UPDATE public.office_user_preferences
  SET preferences = next_preferences,
      revision = revision + 1,
      updated_at = clock_timestamp()
  WHERE user_id = actor_id
    AND circle_id = p_circle_id
  RETURNING revision, updated_at INTO accepted_revision, accepted_updated_at;

  -- Value-free receipt: it proves the server-accepted revision and timestamp
  -- without reflecting any preference or credential-adjacent caller input.
  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'accepted', true,
    'revision', accepted_revision,
    'updatedAt', accepted_updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.read_my_office_preferences_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.patch_my_office_preferences_v1(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_my_office_preferences_v1(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_my_office_preferences_v1(uuid, jsonb)
  TO authenticated;

-- Remove the known legacy Telegram credential object from the circle-readable
-- profile blob. The UPDATE transforms rows in place and never selects, returns,
-- logs, or copies the values. Reapplication is a no-op once the key is absent.
DO $legacy_telegram_scrub$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'office_preferences'
         AND NOT attisdropped
     ) THEN
    UPDATE public.profiles
    SET office_preferences = office_preferences
      - 'telegramConfig'
      - 'agentNames'
      - 'whiteboardNotes'
      - 'budgetConfig'
      - 'idleConfig'
      - 'agentFilterMode'
      - 'appearances'
    WHERE jsonb_typeof(office_preferences) = 'object'
      AND office_preferences ?| ARRAY[
        'telegramConfig',
        'agentNames',
        'whiteboardNotes',
        'budgetConfig',
        'idleConfig',
        'agentFilterMode',
        'appearances'
      ];
  END IF;
END;
$legacy_telegram_scrub$;

-- `profiles.agent_appearance` was a second circle-readable legacy store for
-- the same private appearance map. Erase it in place without projecting its
-- contents. The canonical owner-private copy now lives in
-- `office_user_preferences.preferences.appearances`.
DO $legacy_agent_appearance_scrub$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'agent_appearance'
         AND atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
         AND NOT attisdropped
     ) THEN
    UPDATE public.profiles
    SET agent_appearance = '{}'::jsonb
    WHERE agent_appearance IS DISTINCT FROM '{}'::jsonb;
  END IF;
END;
$legacy_agent_appearance_scrub$;

CREATE OR REPLACE FUNCTION public.strip_legacy_private_office_profile_keys_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.office_preferences IS NOT NULL
     AND jsonb_typeof(NEW.office_preferences) = 'object' THEN
    NEW.office_preferences := NEW.office_preferences
      - 'telegramConfig'
      - 'agentNames'
      - 'whiteboardNotes'
      - 'budgetConfig'
      - 'idleConfig'
      - 'agentFilterMode'
      - 'appearances';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.strip_legacy_private_office_profile_keys_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DO $legacy_profile_trigger$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'office_preferences'
         AND NOT attisdropped
     ) THEN
    DROP TRIGGER IF EXISTS strip_legacy_private_office_profile_keys_v1
      ON public.profiles;
    CREATE TRIGGER strip_legacy_private_office_profile_keys_v1
    BEFORE INSERT OR UPDATE OF office_preferences ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.strip_legacy_private_office_profile_keys_v1();
  END IF;
END;
$legacy_profile_trigger$;

-- Keep the legacy appearance column empty even while older clients still
-- include it in profile inserts or updates. Only this deprecated field is
-- normalized; every unrelated NEW profile field passes through unchanged.
CREATE OR REPLACE FUNCTION public.strip_legacy_private_office_agent_appearance_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.agent_appearance := '{}'::jsonb;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.strip_legacy_private_office_agent_appearance_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DO $legacy_agent_appearance_trigger$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'agent_appearance'
         AND atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
         AND NOT attisdropped
     ) THEN
    DROP TRIGGER IF EXISTS strip_legacy_private_office_agent_appearance_v1
      ON public.profiles;
    CREATE TRIGGER strip_legacy_private_office_agent_appearance_v1
    BEFORE INSERT OR UPDATE OF agent_appearance ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.strip_legacy_private_office_agent_appearance_v1();
  END IF;
END;
$legacy_agent_appearance_trigger$;

COMMIT;

NOTIFY pgrst, 'reload schema';
