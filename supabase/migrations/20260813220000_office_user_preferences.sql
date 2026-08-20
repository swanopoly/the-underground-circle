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

-- Convert one pair of legacy appearance fragments into the complete current
-- 15-field shape. A valid dedicated-field value wins, otherwise a valid value
-- from the old Office preference map wins, otherwise the current safe visual
-- default is used. Unknown legacy fields are never projected into live state.
CREATE OR REPLACE FUNCTION public.normalize_legacy_office_agent_appearance_v1(
  p_office_appearance jsonb,
  p_dedicated_appearance jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'skinTone', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'skinTone') = 'string'
           AND (p_dedicated_appearance ->> 'skinTone') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_dedicated_appearance ->> 'skinTone'
      WHEN jsonb_typeof(p_office_appearance -> 'skinTone') = 'string'
           AND (p_office_appearance ->> 'skinTone') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_office_appearance ->> 'skinTone'
      ELSE '#f5d0a9'
    END,
    'hairStyle', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'hairStyle') = 'string'
           AND (p_dedicated_appearance ->> 'hairStyle') IN (
             'flat', 'spiky', 'mohawk', 'long', 'bald', 'cap', 'curly',
             'ponytail', 'buzzcut', 'afro', 'undercut', 'pigtails'
           ) THEN p_dedicated_appearance ->> 'hairStyle'
      WHEN jsonb_typeof(p_office_appearance -> 'hairStyle') = 'string'
           AND (p_office_appearance ->> 'hairStyle') IN (
             'flat', 'spiky', 'mohawk', 'long', 'bald', 'cap', 'curly',
             'ponytail', 'buzzcut', 'afro', 'undercut', 'pigtails'
           ) THEN p_office_appearance ->> 'hairStyle'
      ELSE 'flat'
    END,
    'hairColor', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'hairColor') = 'string'
           AND (p_dedicated_appearance ->> 'hairColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_dedicated_appearance ->> 'hairColor'
      WHEN jsonb_typeof(p_office_appearance -> 'hairColor') = 'string'
           AND (p_office_appearance ->> 'hairColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_office_appearance ->> 'hairColor'
      ELSE '#000000'
    END,
    'shirtColor', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'shirtColor') = 'string'
           AND (p_dedicated_appearance ->> 'shirtColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_dedicated_appearance ->> 'shirtColor'
      WHEN jsonb_typeof(p_office_appearance -> 'shirtColor') = 'string'
           AND (p_office_appearance ->> 'shirtColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_office_appearance ->> 'shirtColor'
      ELSE '#6366f1'
    END,
    'pantsColor', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'pantsColor') = 'string'
           AND (p_dedicated_appearance ->> 'pantsColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_dedicated_appearance ->> 'pantsColor'
      WHEN jsonb_typeof(p_office_appearance -> 'pantsColor') = 'string'
           AND (p_office_appearance ->> 'pantsColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_office_appearance ->> 'pantsColor'
      ELSE '#2d2d3d'
    END,
    'shoeColor', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'shoeColor') = 'string'
           AND (p_dedicated_appearance ->> 'shoeColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_dedicated_appearance ->> 'shoeColor'
      WHEN jsonb_typeof(p_office_appearance -> 'shoeColor') = 'string'
           AND (p_office_appearance ->> 'shoeColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_office_appearance ->> 'shoeColor'
      ELSE '#000000'
    END,
    'accessory', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'accessory') = 'string'
           AND (p_dedicated_appearance ->> 'accessory') IN (
             'none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie',
             'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing',
             'visor_shades', 'gas_mask'
           ) THEN p_dedicated_appearance ->> 'accessory'
      WHEN jsonb_typeof(p_office_appearance -> 'accessory') = 'string'
           AND (p_office_appearance ->> 'accessory') IN (
             'none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie',
             'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing',
             'visor_shades', 'gas_mask'
           ) THEN p_office_appearance ->> 'accessory'
      ELSE 'none'
    END,
    'hat', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'hat') = 'string'
           AND (p_dedicated_appearance ->> 'hat') IN (
             'none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns',
             'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet',
             'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'
           ) THEN p_dedicated_appearance ->> 'hat'
      WHEN jsonb_typeof(p_office_appearance -> 'hat') = 'string'
           AND (p_office_appearance ->> 'hat') IN (
             'none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns',
             'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet',
             'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'
           ) THEN p_office_appearance ->> 'hat'
      ELSE 'none'
    END,
    'expression', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'expression') = 'string'
           AND (p_dedicated_appearance ->> 'expression') IN (
             'neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry',
             'surprised', 'smirk', 'crying'
           ) THEN p_dedicated_appearance ->> 'expression'
      WHEN jsonb_typeof(p_office_appearance -> 'expression') = 'string'
           AND (p_office_appearance ->> 'expression') IN (
             'neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry',
             'surprised', 'smirk', 'crying'
           ) THEN p_office_appearance ->> 'expression'
      ELSE 'neutral'
    END,
    'backItem', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'backItem') = 'string'
           AND (p_dedicated_appearance ->> 'backItem') IN (
             'none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword',
             'quiver', 'crab_shell', 'tentacles', 'rocket', 'scroll', 'boombox'
           ) THEN p_dedicated_appearance ->> 'backItem'
      WHEN jsonb_typeof(p_office_appearance -> 'backItem') = 'string'
           AND (p_office_appearance ->> 'backItem') IN (
             'none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword',
             'quiver', 'crab_shell', 'tentacles', 'rocket', 'scroll', 'boombox'
           ) THEN p_office_appearance ->> 'backItem'
      ELSE 'none'
    END,
    'eyeColor', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'eyeColor') = 'string'
           AND (p_dedicated_appearance ->> 'eyeColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_dedicated_appearance ->> 'eyeColor'
      WHEN jsonb_typeof(p_office_appearance -> 'eyeColor') = 'string'
           AND (p_office_appearance ->> 'eyeColor') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
        THEN p_office_appearance ->> 'eyeColor'
      ELSE '#000000'
    END,
    'facialHair', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'facialHair') = 'string'
           AND (p_dedicated_appearance ->> 'facialHair') IN (
             'none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu',
             'sideburns', 'soul_patch'
           ) THEN p_dedicated_appearance ->> 'facialHair'
      WHEN jsonb_typeof(p_office_appearance -> 'facialHair') = 'string'
           AND (p_office_appearance ->> 'facialHair') IN (
             'none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu',
             'sideburns', 'soul_patch'
           ) THEN p_office_appearance ->> 'facialHair'
      ELSE 'none'
    END,
    'pet', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'pet') = 'string'
           AND (p_dedicated_appearance ->> 'pet') IN (
             'none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab',
             'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones', 'swan'
           ) THEN p_dedicated_appearance ->> 'pet'
      WHEN jsonb_typeof(p_office_appearance -> 'pet') = 'string'
           AND (p_office_appearance ->> 'pet') IN (
             'none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab',
             'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones', 'swan'
           ) THEN p_office_appearance ->> 'pet'
      ELSE 'none'
    END,
    'aura', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'aura') = 'string'
           AND (p_dedicated_appearance ->> 'aura') IN (
             'none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow',
             'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'
           ) THEN p_dedicated_appearance ->> 'aura'
      WHEN jsonb_typeof(p_office_appearance -> 'aura') = 'string'
           AND (p_office_appearance ->> 'aura') IN (
             'none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow',
             'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'
           ) THEN p_office_appearance ->> 'aura'
      ELSE 'none'
    END,
    'handItem', CASE
      WHEN jsonb_typeof(p_dedicated_appearance -> 'handItem') = 'string'
           AND (p_dedicated_appearance ->> 'handItem') IN (
             'none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand',
             'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'
           ) THEN p_dedicated_appearance ->> 'handItem'
      WHEN jsonb_typeof(p_office_appearance -> 'handItem') = 'string'
           AND (p_office_appearance ->> 'handItem') IN (
             'none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand',
             'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'
           ) THEN p_office_appearance ->> 'handItem'
      ELSE 'none'
    END
  );
$function$;

REVOKE ALL ON FUNCTION public.normalize_legacy_office_agent_appearance_v1(jsonb, jsonb)
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
DO $office_user_preferences_policy_reset$
DECLARE
  policy_name text;
BEGIN
  FOR policy_name IN
    SELECT policy.polname
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.office_user_preferences'::regclass
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.office_user_preferences',
      policy_name
    );
  END LOOP;
END;
$office_user_preferences_policy_reset$;
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

-- Preserve normalized legacy appearance state that cannot fit in the bounded
-- live preference document. This table is an owner-readable recovery archive,
-- never a second client writer. The app continues to read and patch only
-- `office_user_preferences`; authenticated roles receive no archive DML.
CREATE TABLE IF NOT EXISTS public.office_user_legacy_appearances (
  user_id uuid NOT NULL,
  circle_id uuid NOT NULL,
  agent_key text COLLATE "C" NOT NULL,
  appearance jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT office_user_legacy_appearances_pkey
    PRIMARY KEY (user_id, circle_id, agent_key),
  CONSTRAINT office_user_legacy_appearances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT office_user_legacy_appearances_circle_id_fkey
    FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE,
  CONSTRAINT office_user_legacy_appearance_key_valid
    CHECK (
      length(agent_key) BETWEEN 1 AND 240
      AND octet_length(agent_key) <= 960
    ),
  CONSTRAINT office_user_legacy_appearance_document_valid
    CHECK (
      public.validate_office_user_preferences_v1(
        jsonb_build_object(
          'appearances',
          jsonb_build_object('archived-agent', appearance)
        )
      )
    )
);

-- `CREATE TABLE IF NOT EXISTS` must not turn a pre-existing incompatible
-- relation into migration authority. Verify the exact active-column and
-- primary-key shape before any legacy source can be copied or scrubbed.
DO $legacy_appearance_archive_schema$
DECLARE
  active_column_count integer;
  primary_key_columns text[];
BEGIN
  SELECT count(*)
  INTO active_column_count
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.office_user_legacy_appearances'::regclass
    AND attnum > 0
    AND NOT attisdropped;

  IF active_column_count <> 5
     OR EXISTS (
       SELECT 1
       FROM (
         VALUES
           ('user_id'::text, 'uuid'::text),
           ('circle_id'::text, 'uuid'::text),
           ('agent_key'::text, 'text'::text),
           ('appearance'::text, 'jsonb'::text),
           ('archived_at'::text, 'timestamp with time zone'::text)
       ) AS expected(attname, formatted_type)
       LEFT JOIN pg_catalog.pg_attribute AS actual
         ON actual.attrelid = 'public.office_user_legacy_appearances'::regclass
        AND actual.attname = expected.attname
        AND actual.attnum > 0
        AND NOT actual.attisdropped
       WHERE actual.attname IS NULL
          OR NOT actual.attnotnull
          OR pg_catalog.format_type(actual.atttypid, actual.atttypmod)
             IS DISTINCT FROM expected.formatted_type
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS actual
       WHERE actual.attrelid = 'public.office_user_legacy_appearances'::regclass
         AND actual.attname = 'agent_key'
         AND actual.attnum > 0
         AND NOT actual.attisdropped
         AND actual.attcollation IS DISTINCT FROM
           'pg_catalog."C"'::pg_catalog.regcollation
     ) THEN
    RAISE EXCEPTION 'office_legacy_appearance_archive_schema_mismatch';
  END IF;

  SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
  INTO primary_key_columns
  FROM pg_catalog.pg_constraint AS constraint_definition
  CROSS JOIN LATERAL unnest(constraint_definition.conkey)
    WITH ORDINALITY AS key_column(attnum, ordinality)
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = constraint_definition.conrelid
   AND attribute.attnum = key_column.attnum
  WHERE constraint_definition.conrelid =
      'public.office_user_legacy_appearances'::regclass
    AND constraint_definition.contype = 'p';

  IF primary_key_columns IS DISTINCT FROM
      ARRAY['user_id', 'circle_id', 'agent_key']::text[] THEN
    RAISE EXCEPTION 'office_legacy_appearance_archive_primary_key_mismatch';
  END IF;
END;
$legacy_appearance_archive_schema$;

ALTER TABLE public.office_user_legacy_appearances
  DROP CONSTRAINT IF EXISTS office_user_legacy_appearances_user_id_fkey;
ALTER TABLE public.office_user_legacy_appearances
  ADD CONSTRAINT office_user_legacy_appearances_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.office_user_legacy_appearances
  DROP CONSTRAINT IF EXISTS office_user_legacy_appearances_circle_id_fkey;
ALTER TABLE public.office_user_legacy_appearances
  ADD CONSTRAINT office_user_legacy_appearances_circle_id_fkey
  FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE;
ALTER TABLE public.office_user_legacy_appearances
  DROP CONSTRAINT IF EXISTS office_user_legacy_appearance_key_valid;
ALTER TABLE public.office_user_legacy_appearances
  ADD CONSTRAINT office_user_legacy_appearance_key_valid
  CHECK (
    length(agent_key) BETWEEN 1 AND 240
    AND octet_length(agent_key) <= 960
  );
ALTER TABLE public.office_user_legacy_appearances
  DROP CONSTRAINT IF EXISTS office_user_legacy_appearance_document_valid;
ALTER TABLE public.office_user_legacy_appearances
  ADD CONSTRAINT office_user_legacy_appearance_document_valid
  CHECK (
    public.validate_office_user_preferences_v1(
      jsonb_build_object(
        'appearances',
        jsonb_build_object('archived-agent', appearance)
      )
    )
  );

ALTER TABLE public.office_user_legacy_appearances
  ALTER COLUMN archived_at SET DEFAULT clock_timestamp();

ALTER TABLE public.office_user_legacy_appearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_user_legacy_appearances FORCE ROW LEVEL SECURITY;
DO $legacy_appearance_archive_policy_reset$
DECLARE
  policy_name text;
BEGIN
  FOR policy_name IN
    SELECT policy.polname
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.office_user_legacy_appearances'::regclass
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.office_user_legacy_appearances',
      policy_name
    );
  END LOOP;
END;
$legacy_appearance_archive_policy_reset$;
CREATE POLICY office_user_legacy_appearances_select_own
ON public.office_user_legacy_appearances
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = office_user_legacy_appearances.circle_id
      AND membership.user_id = auth.uid()
  )
);

REVOKE ALL ON TABLE public.office_user_legacy_appearances
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.office_user_legacy_appearances TO authenticated;

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

-- Copy and scrub share one transaction, and both legacy source tables stay
-- write-stable from eligibility through the final scrub. Acquisition fails
-- closed under live write traffic instead of waiting indefinitely; operators
-- should apply this section only after the value-free candidate-count preflight
-- confirms a bounded batch and during a low-write window.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $legacy_private_office_lock$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND pg_catalog.to_regclass('public.circle_members') IS NOT NULL
     AND pg_catalog.to_regclass('public.circle_office_agents') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.profiles, public.circle_members, public.circle_office_agents IN SHARE MODE';
    LOCK TABLE public.office_user_legacy_appearances IN SHARE ROW EXCLUSIVE MODE;
  ELSE
    RAISE EXCEPTION 'office_legacy_preference_source_schema_missing';
  END IF;
END;
$legacy_private_office_lock$;

-- Abort before creating any preservation receipt when source ownership,
-- reviewed-field safety, or per-entry normalization cannot be proven. The
-- exception text is constant and never includes a user id, agent key, or
-- preference value.
DO $legacy_private_office_preflight$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'office_preferences'
         AND atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
         AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'agent_appearance'
         AND atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
         AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'office_legacy_preference_source_schema_missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE (
        (
          jsonb_typeof(profile.office_preferences) = 'object'
          AND profile.office_preferences ?| ARRAY[
            'agentNames',
            'appearances',
            'whiteboardNotes',
            'budgetConfig',
            'idleConfig',
            'agentFilterMode'
          ]
        )
        OR coalesce(profile.agent_appearance, '{}'::jsonb) <> '{}'::jsonb
      )
      AND (
        SELECT count(*)
        FROM public.circle_members AS membership
        WHERE membership.user_id = profile.id
      ) <> 1
  ) THEN
    RAISE EXCEPTION 'office_legacy_preference_membership_ambiguous';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE public.office_preferences_contains_secret_key_v1(
      jsonb_build_object(
        'agentNames', profile.office_preferences -> 'agentNames',
        'appearances', profile.office_preferences -> 'appearances',
        'whiteboardNotes', profile.office_preferences -> 'whiteboardNotes',
        'budgetConfig', profile.office_preferences -> 'budgetConfig',
        'idleConfig', profile.office_preferences -> 'idleConfig',
        'agentFilterMode', profile.office_preferences -> 'agentFilterMode',
        'dedicatedAppearances', profile.agent_appearance
      )
    )
  ) THEN
    RAISE EXCEPTION 'office_legacy_preference_reviewed_source_unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE (
        profile.office_preferences IS NOT NULL
        AND jsonb_typeof(profile.office_preferences) <> 'object'
      )
      OR (
        coalesce(profile.agent_appearance, '{}'::jsonb) <> '{}'::jsonb
        AND jsonb_typeof(profile.agent_appearance) <> 'object'
      )
      OR (
        jsonb_typeof(profile.office_preferences) = 'object'
        AND profile.office_preferences ? 'appearances'
        AND jsonb_typeof(profile.office_preferences -> 'appearances') <> 'object'
      )
  ) THEN
    RAISE EXCEPTION 'office_legacy_preference_source_invalid';
  END IF;

  IF EXISTS (
    WITH appearance_sources AS (
      SELECT
        CASE
          WHEN jsonb_typeof(profile.office_preferences -> 'appearances') = 'object'
            THEN profile.office_preferences -> 'appearances'
          ELSE '{}'::jsonb
        END AS office_appearances,
        CASE
          WHEN jsonb_typeof(profile.agent_appearance) = 'object'
            THEN profile.agent_appearance
          ELSE '{}'::jsonb
        END AS dedicated_appearances
      FROM public.profiles AS profile
    ), appearance_entries AS (
      SELECT
        source.office_appearances,
        source.dedicated_appearances,
        appearance_name.key AS agent_key
      FROM appearance_sources AS source
      CROSS JOIN LATERAL (
        SELECT key COLLATE "C" AS key FROM jsonb_object_keys(source.office_appearances) AS key
        UNION
        SELECT key COLLATE "C" AS key FROM jsonb_object_keys(source.dedicated_appearances) AS key
      ) AS appearance_name
    )
    SELECT 1
    FROM appearance_entries AS entry
    WHERE length(entry.agent_key) NOT BETWEEN 1 AND 240
       OR octet_length(entry.agent_key) > 960
       OR (
         entry.office_appearances ? entry.agent_key
         AND (
           jsonb_typeof(entry.office_appearances -> entry.agent_key) <> 'object'
           OR octet_length((entry.office_appearances -> entry.agent_key)::text) > 16384
         )
       )
       OR (
         entry.dedicated_appearances ? entry.agent_key
         AND (
           jsonb_typeof(entry.dedicated_appearances -> entry.agent_key) <> 'object'
           OR octet_length((entry.dedicated_appearances -> entry.agent_key)::text) > 16384
         )
       )
  ) THEN
    RAISE EXCEPTION 'office_legacy_appearance_entry_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    CROSS JOIN LATERAL (
      VALUES
        ('agentNames'::text),
        ('whiteboardNotes'::text),
        ('budgetConfig'::text),
        ('agentFilterMode'::text)
    ) AS reviewed(preference_key)
    WHERE jsonb_typeof(profile.office_preferences) = 'object'
      AND profile.office_preferences ? reviewed.preference_key
      AND NOT public.validate_office_user_preferences_v1(
        jsonb_build_object(
          reviewed.preference_key,
          profile.office_preferences -> reviewed.preference_key
        )
      )
  ) THEN
    RAISE EXCEPTION 'office_legacy_preference_reviewed_field_invalid';
  END IF;
END;
$legacy_private_office_preflight$;

-- Materialize the exact normalized appearance union once. Subsequent archive
-- publication, equality proof, and active-map projection consume this same
-- transaction-local snapshot, so a later CTE cannot silently reinterpret the
-- legacy source.
CREATE TEMP TABLE office_legacy_appearance_expected_v1
ON COMMIT DROP
AS
WITH eligible_profiles AS (
  SELECT
    profile.id AS user_id,
    membership.circle_id,
    CASE
      WHEN jsonb_typeof(profile.office_preferences -> 'appearances') = 'object'
        THEN profile.office_preferences -> 'appearances'
      ELSE '{}'::jsonb
    END AS office_appearances,
    CASE
      WHEN jsonb_typeof(profile.agent_appearance) = 'object'
        THEN profile.agent_appearance
      ELSE '{}'::jsonb
    END AS dedicated_appearances
  FROM public.profiles AS profile
  CROSS JOIN LATERAL (
    SELECT candidate.circle_id
    FROM public.circle_members AS candidate
    WHERE candidate.user_id = profile.id
    LIMIT 1
  ) AS membership
  WHERE (
      jsonb_typeof(profile.office_preferences -> 'appearances') = 'object'
      AND profile.office_preferences -> 'appearances' <> '{}'::jsonb
    )
    OR (
      jsonb_typeof(profile.agent_appearance) = 'object'
      AND profile.agent_appearance <> '{}'::jsonb
    )
), appearance_entries AS (
  SELECT
    source.user_id,
    source.circle_id,
    appearance_name.key COLLATE "C" AS agent_key,
    source.office_appearances -> appearance_name.key AS office_appearance,
    source.dedicated_appearances -> appearance_name.key AS dedicated_appearance
  FROM eligible_profiles AS source
  CROSS JOIN LATERAL (
    SELECT key COLLATE "C" AS key FROM jsonb_object_keys(source.office_appearances) AS key
    UNION
    SELECT key COLLATE "C" AS key FROM jsonb_object_keys(source.dedicated_appearances) AS key
  ) AS appearance_name
)
SELECT
  user_id,
  circle_id,
  agent_key,
  public.normalize_legacy_office_agent_appearance_v1(
    office_appearance,
    dedicated_appearance
  ) AS appearance
FROM appearance_entries;

ALTER TABLE pg_temp.office_legacy_appearance_expected_v1
  ADD CONSTRAINT office_legacy_appearance_expected_v1_pkey
  PRIMARY KEY (user_id, circle_id, agent_key);

INSERT INTO public.office_user_legacy_appearances(
  user_id,
  circle_id,
  agent_key,
  appearance,
  archived_at
)
SELECT
  user_id,
  circle_id,
  agent_key,
  appearance,
  clock_timestamp()
FROM pg_temp.office_legacy_appearance_expected_v1
ON CONFLICT (user_id, circle_id, agent_key) DO NOTHING;

-- Compare keys and complete normalized JSON values after the INSERT statement;
-- PostgreSQL 14 does not expose same-statement DML changes through a second
-- base-table scan. Existing unequal archive rows or unexplained extras for a
-- currently populated source scope abort the whole copy-and-scrub transaction.
DO $legacy_appearance_archive_receipt$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_temp.office_legacy_appearance_expected_v1 AS expected
    LEFT JOIN public.office_user_legacy_appearances AS archived
      USING (user_id, circle_id, agent_key)
    WHERE archived.user_id IS NULL
       OR archived.appearance IS DISTINCT FROM expected.appearance
  )
  OR EXISTS (
    SELECT 1
    FROM public.office_user_legacy_appearances AS archived
    JOIN (
      SELECT DISTINCT user_id, circle_id
      FROM pg_temp.office_legacy_appearance_expected_v1
    ) AS populated_scope
      USING (user_id, circle_id)
    LEFT JOIN pg_temp.office_legacy_appearance_expected_v1 AS expected
      USING (user_id, circle_id, agent_key)
    WHERE expected.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'office_legacy_appearance_archive_receipt_mismatch';
  END IF;
END;
$legacy_appearance_archive_receipt$;

DO $legacy_active_appearance_capacity$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_temp.office_legacy_appearance_expected_v1 AS expected
    JOIN public.circle_office_agents AS roster
      ON roster.owner_id = expected.user_id
     AND roster.circle_id = expected.circle_id
     AND roster.id::text = expected.agent_key
    GROUP BY expected.user_id, expected.circle_id
    HAVING count(*) > 128
  ) THEN
    RAISE EXCEPTION 'office_legacy_active_roster_appearance_capacity_exceeded';
  END IF;
END;
$legacy_active_appearance_capacity$;

-- Preserve an unambiguous legacy owner before erasing the peer-readable
-- fields. A profile with exactly one current circle membership has one safe
-- destination; zero or multiple memberships have no inferable circle and
-- therefore fail closed. Only reviewed non-secret fields are projected.
-- `telegramConfig` is deliberately never selected, copied, returned, or
-- logged. Partial legacy appearance entries are completed from the current
-- safe visual defaults, with the dedicated legacy map winning field-level
-- collisions. Partial legacy idle state is completed with disabled behavior
-- defaults; malformed nested entries are dropped. The canonical validator
-- must accept the complete normalized document before any row is inserted.
--
-- `ON CONFLICT DO NOTHING` makes reapplication unable to overwrite a newer
-- private row written by the app or another tab.
DO $legacy_private_office_copy$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'office_preferences'
         AND atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
         AND NOT attisdropped
     )
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'agent_appearance'
         AND atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
         AND NOT attisdropped
     ) THEN
    EXECUTE $copy$
      WITH eligible_profiles AS (
        SELECT
          profile.id AS user_id,
          membership.circle_id,
          profile.office_preferences -> 'agentNames' AS agent_names,
          profile.office_preferences -> 'appearances' AS office_appearances,
          profile.office_preferences -> 'whiteboardNotes' AS whiteboard_notes,
          profile.office_preferences -> 'budgetConfig' AS budget_config,
          profile.office_preferences -> 'idleConfig' AS legacy_idle_config,
          profile.office_preferences -> 'agentFilterMode' AS agent_filter_mode,
          profile.agent_appearance
        FROM public.profiles AS profile
        CROSS JOIN LATERAL (
          SELECT candidate.circle_id
          FROM public.circle_members AS candidate
          WHERE candidate.user_id = profile.id
            AND (
              SELECT count(*)
              FROM public.circle_members AS exact_membership
              WHERE exact_membership.user_id = profile.id
            ) = 1
          LIMIT 1
        ) AS membership
      ), legacy_sources AS (
        SELECT
          user_id,
          circle_id,
          agent_names,
          CASE
            WHEN jsonb_typeof(office_appearances) = 'object'
              THEN office_appearances
            ELSE '{}'::jsonb
          END AS office_appearances,
          CASE
            WHEN jsonb_typeof(agent_appearance) = 'object'
              THEN agent_appearance
            ELSE '{}'::jsonb
          END AS dedicated_appearances,
          whiteboard_notes,
          budget_config,
          legacy_idle_config,
          agent_filter_mode,
          public.office_preferences_contains_secret_key_v1(
            jsonb_build_object(
              'agentNames', agent_names,
              'appearances', office_appearances,
              'whiteboardNotes', whiteboard_notes,
              'budgetConfig', budget_config,
              'idleConfig', legacy_idle_config,
              'agentFilterMode', agent_filter_mode,
              'dedicatedAppearances', agent_appearance
            )
          ) AS source_contains_secret
        FROM eligible_profiles
      ), active_appearance_candidates AS (
        SELECT
          expected.user_id,
          expected.circle_id,
          expected.agent_key,
          expected.appearance,
          0 AS source_priority
        FROM pg_temp.office_legacy_appearance_expected_v1 AS expected
        JOIN public.circle_office_agents AS roster
          ON roster.owner_id = expected.user_id
         AND roster.circle_id = expected.circle_id
         AND roster.id::text = expected.agent_key
        UNION ALL
        SELECT
          expected.user_id,
          expected.circle_id,
          expected.agent_key,
          expected.appearance,
          1 AS source_priority
        FROM pg_temp.office_legacy_appearance_expected_v1 AS expected
        JOIN legacy_sources AS source
          USING (user_id, circle_id)
        WHERE jsonb_typeof(source.agent_names) = 'object'
          AND source.agent_names ? expected.agent_key
      ), deduplicated_active_appearances AS (
        SELECT DISTINCT ON (user_id, circle_id, agent_key COLLATE "C")
          user_id,
          circle_id,
          agent_key,
          appearance,
          source_priority
        FROM active_appearance_candidates
        ORDER BY
          user_id,
          circle_id,
          agent_key COLLATE "C",
          source_priority
      ), ranked_active_appearances AS (
        SELECT
          user_id,
          circle_id,
          agent_key,
          appearance,
          row_number() OVER (
            PARTITION BY user_id, circle_id
            ORDER BY source_priority, agent_key COLLATE "C"
          ) AS active_rank
        FROM deduplicated_active_appearances
      ), normalized_appearance_entries AS (
        SELECT
          user_id,
          circle_id,
          agent_key,
          appearance
        FROM ranked_active_appearances
        WHERE active_rank <= 128
      ), normalized_appearances AS (
        SELECT
          user_id,
          circle_id,
          jsonb_object_agg(agent_key, appearance ORDER BY agent_key) AS appearances
        FROM normalized_appearance_entries
        GROUP BY user_id, circle_id
      ), idle_sources AS (
        SELECT
          user_id,
          circle_id,
          legacy_idle_config,
          CASE
            WHEN jsonb_typeof(legacy_idle_config -> 'behaviors') = 'object'
              THEN legacy_idle_config -> 'behaviors'
            ELSE '{}'::jsonb
          END AS legacy_behaviors,
          CASE
            WHEN jsonb_typeof(legacy_idle_config -> 'sharedChatOptIn') = 'boolean'
              THEN (legacy_idle_config ->> 'sharedChatOptIn')::boolean
            ELSE false
          END AS shared_chat_opt_in
        FROM legacy_sources
        WHERE jsonb_typeof(legacy_idle_config) = 'object'
      ), idle_behavior_entries AS (
        SELECT
          source.user_id,
          source.circle_id,
          behavior.key AS behavior_key,
          jsonb_build_object(
            'enabled', CASE
              WHEN jsonb_typeof(behavior.value -> 'enabled') = 'boolean'
                THEN (behavior.value ->> 'enabled')::boolean
              ELSE false
            END,
            'cooldownMinutes', CASE
              WHEN jsonb_typeof(behavior.value -> 'cooldownMinutes') = 'number'
                   AND (behavior.value ->> 'cooldownMinutes')::numeric
                     = trunc((behavior.value ->> 'cooldownMinutes')::numeric)
                   AND (behavior.value ->> 'cooldownMinutes')::numeric BETWEEN 1 AND 10080
                THEN (behavior.value ->> 'cooldownMinutes')::numeric
              ELSE 1440
            END,
            'lastRanAt', CASE
              WHEN jsonb_typeof(behavior.value -> 'lastRanAt') = 'string'
                   AND length(behavior.value ->> 'lastRanAt') <= 40
                   AND (behavior.value ->> 'lastRanAt')
                     ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
                THEN behavior.value ->> 'lastRanAt'
              ELSE NULL
            END
          ) AS behavior_state
        FROM idle_sources AS source
        CROSS JOIN LATERAL jsonb_each(source.legacy_behaviors) AS behavior
        WHERE (
            SELECT count(*) FROM jsonb_object_keys(source.legacy_behaviors)
          ) <= 64
          AND length(behavior.key) BETWEEN 1 AND 80
          AND octet_length(behavior.key) <= 320
          AND jsonb_typeof(behavior.value) = 'object'
          AND octet_length(behavior.value::text) <= 4096
      ), normalized_idle_behaviors AS (
        SELECT
          user_id,
          circle_id,
          jsonb_object_agg(behavior_key, behavior_state ORDER BY behavior_key) AS behaviors
        FROM idle_behavior_entries
        GROUP BY user_id, circle_id
      ), normalized_idle_configs AS (
        SELECT
          source.user_id,
          source.circle_id,
          jsonb_build_object(
            'masterEnabled', CASE
              WHEN jsonb_typeof(source.legacy_idle_config -> 'masterEnabled') = 'boolean'
                THEN (source.legacy_idle_config ->> 'masterEnabled')::boolean
              ELSE false
            END,
            'behaviors', coalesce(normalized.behaviors, '{}'::jsonb),
            'sharedChatOptIn', source.shared_chat_opt_in
          ) AS idle_config
        FROM idle_sources AS source
        LEFT JOIN normalized_idle_behaviors AS normalized
          USING (user_id, circle_id)
      ), candidate_documents AS (
        SELECT
          source.user_id,
          source.circle_id,
          (
            SELECT coalesce(
              jsonb_object_agg(preference.key, preference.value ORDER BY preference.key),
              '{}'::jsonb
            )
            FROM jsonb_each(jsonb_build_object(
              'agentNames', source.agent_names,
              'appearances', normalized_appearance.appearances,
              'whiteboardNotes', source.whiteboard_notes,
              'budgetConfig', source.budget_config,
              'idleConfig', normalized_idle.idle_config,
              'agentFilterMode', source.agent_filter_mode
            )) AS preference
            WHERE preference.value <> 'null'::jsonb
          ) AS preferences,
          source.source_contains_secret
        FROM legacy_sources AS source
        LEFT JOIN normalized_appearances AS normalized_appearance
          USING (user_id, circle_id)
        LEFT JOIN normalized_idle_configs AS normalized_idle
          USING (user_id, circle_id)
      )
      INSERT INTO public.office_user_preferences(
        user_id,
        circle_id,
        preferences,
        revision,
        updated_at
      )
      SELECT
        user_id,
        circle_id,
        preferences,
        1,
        clock_timestamp()
      FROM candidate_documents
      WHERE preferences <> '{}'::jsonb
        AND NOT source_contains_secret
        AND public.validate_office_user_preferences_v1(preferences)
      ON CONFLICT (user_id, circle_id) DO NOTHING
    $copy$;
  END IF;
END;
$legacy_private_office_copy$;

-- A source profile that owns any reviewed live field or any currently
-- relevant archived appearance must now have a valid private preference row.
-- A pre-existing newer row is accepted; a silently filtered/oversized legacy
-- candidate is not.
DO $legacy_private_office_copy_receipt$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    CROSS JOIN LATERAL (
      SELECT membership.circle_id
      FROM public.circle_members AS membership
      WHERE membership.user_id = profile.id
      LIMIT 1
    ) AS exact_scope
    WHERE (
        (
          jsonb_typeof(profile.office_preferences) = 'object'
          AND profile.office_preferences ?| ARRAY[
            'agentNames',
            'whiteboardNotes',
            'budgetConfig',
            'idleConfig',
            'agentFilterMode'
          ]
        )
        OR EXISTS (
          SELECT 1
          FROM pg_temp.office_legacy_appearance_expected_v1 AS expected
          WHERE expected.user_id = profile.id
            AND expected.circle_id = exact_scope.circle_id
            AND (
              EXISTS (
                SELECT 1
                FROM public.circle_office_agents AS roster
                WHERE roster.owner_id = expected.user_id
                  AND roster.circle_id = expected.circle_id
                  AND roster.id::text = expected.agent_key
              )
              OR (
                jsonb_typeof(profile.office_preferences -> 'agentNames') = 'object'
                AND profile.office_preferences -> 'agentNames' ? expected.agent_key
              )
            )
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.office_user_preferences AS stored
        WHERE stored.user_id = profile.id
          AND stored.circle_id = exact_scope.circle_id
      )
  ) THEN
    RAISE EXCEPTION 'office_legacy_preference_copy_receipt_missing';
  END IF;
END;
$legacy_private_office_copy_receipt$;

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
-- the same private appearance map. Erase it only after the complete normalized
-- union is proven in the owner-private recovery archive; the deterministic
-- currently relevant subset also lives in
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
