-- Let deleting an Auth user remove its one-to-one public profile.
--
-- The original schema created profiles.id -> auth.users.id with PostgreSQL's
-- default ON DELETE NO ACTION. GoTrue/Admin user deletion therefore failed as
-- soon as the generated profile existed. This migration changes only that
-- delete action. It preserves the FK name, columns, parent key, validation,
-- update action, match type, and deferrability, and it verifies that the Auth
-- signup trigger remains enabled and attached to the existing profile handler.

BEGIN;

LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;

DO $migration$
DECLARE
  profiles_relation oid := pg_catalog.to_regclass('public.profiles');
  auth_users_relation oid := pg_catalog.to_regclass('auth.users');
  profile_handler oid := pg_catalog.to_regprocedure('public.handle_new_user()');
  profiles_id_attribute smallint;
  auth_users_id_attribute smallint;
  named_constraint_count integer;
  signup_trigger_count integer;
  profile_fk record;
  profile_handler_row record;
BEGIN
  IF profiles_relation IS NULL OR auth_users_relation IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_missing_required_relation';
  END IF;

  SELECT attribute.attnum
  INTO profiles_id_attribute
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = profiles_relation
    AND attribute.attname = 'id'
    AND attribute.attisdropped IS FALSE;

  SELECT attribute.attnum
  INTO auth_users_id_attribute
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = auth_users_relation
    AND attribute.attname = 'id'
    AND attribute.attisdropped IS FALSE;

  IF profiles_id_attribute IS NULL OR auth_users_id_attribute IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_missing_required_id_column';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = profiles_relation
      AND constraint_row.contype = 'p'
      AND constraint_row.conkey = ARRAY[profiles_id_attribute]::smallint[]
      AND constraint_row.convalidated IS TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_unexpected_profile_primary_key';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO named_constraint_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = profiles_relation
    AND constraint_row.conname = 'profiles_id_fkey';

  IF named_constraint_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_unexpected_constraint_count';
  END IF;

  SELECT constraint_row.*
  INTO profile_fk
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = profiles_relation
    AND constraint_row.conname = 'profiles_id_fkey';

  IF profile_fk.contype <> 'f'
    OR profile_fk.confrelid <> auth_users_relation
    OR profile_fk.conkey <> ARRAY[profiles_id_attribute]::smallint[]
    OR profile_fk.confkey <> ARRAY[auth_users_id_attribute]::smallint[]
    OR profile_fk.confmatchtype <> 's'
    OR profile_fk.confupdtype <> 'a'
    OR profile_fk.confdeltype NOT IN ('a', 'c')
    OR profile_fk.condeferrable IS TRUE
    OR profile_fk.condeferred IS TRUE
    OR profile_fk.convalidated IS NOT TRUE
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_unexpected_constraint_shape';
  END IF;

  -- The signup path must still create a profile for each new Auth user. This
  -- migration does not replace either object; these checks make that an
  -- explicit precondition and prevent a superficially successful partial fix.
  IF profile_handler IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_missing_signup_handler';
  END IF;

  SELECT procedure_row.*
  INTO profile_handler_row
  FROM pg_catalog.pg_proc AS procedure_row
  WHERE procedure_row.oid = profile_handler;

  IF profile_handler_row.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
    OR profile_handler_row.prosecdef IS NOT TRUE
    OR pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(profile_handler)),
      'insert into profiles'
    ) = 0
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_unexpected_signup_handler';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO signup_trigger_count
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = auth_users_relation
    AND trigger_row.tgname = 'on_auth_user_created'
    AND trigger_row.tgisinternal IS FALSE
    AND trigger_row.tgfoid = profile_handler
    AND trigger_row.tgtype = 5
    AND trigger_row.tgenabled IN ('O', 'A');

  IF signup_trigger_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_unexpected_signup_trigger';
  END IF;

  IF profile_fk.confdeltype = 'a' THEN
    ALTER TABLE public.profiles
      DROP CONSTRAINT profiles_id_fkey;

    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_id_fkey
      FOREIGN KEY (id)
      REFERENCES auth.users(id)
      MATCH SIMPLE
      ON UPDATE NO ACTION
      ON DELETE CASCADE
      NOT DEFERRABLE;
  END IF;

  -- Verify the complete FK contract after either the first application or an
  -- idempotent retry. confdeltype = 'c' is PostgreSQL's catalog code for
  -- ON DELETE CASCADE.
  SELECT constraint_row.*
  INTO profile_fk
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = profiles_relation
    AND constraint_row.conname = 'profiles_id_fkey';

  IF NOT FOUND
    OR profile_fk.contype <> 'f'
    OR profile_fk.confrelid <> auth_users_relation
    OR profile_fk.conkey <> ARRAY[profiles_id_attribute]::smallint[]
    OR profile_fk.confkey <> ARRAY[auth_users_id_attribute]::smallint[]
    OR profile_fk.confmatchtype <> 's'
    OR profile_fk.confupdtype <> 'a'
    OR profile_fk.confdeltype <> 'c'
    OR profile_fk.condeferrable IS TRUE
    OR profile_fk.condeferred IS TRUE
    OR profile_fk.convalidated IS NOT TRUE
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_postcondition_failed';
  END IF;

  -- Recheck the signup trigger after the constraint replacement. No trigger or
  -- function DDL is needed for this fix.
  SELECT pg_catalog.count(*)::integer
  INTO signup_trigger_count
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = auth_users_relation
    AND trigger_row.tgname = 'on_auth_user_created'
    AND trigger_row.tgisinternal IS FALSE
    AND trigger_row.tgfoid = profile_handler
    AND trigger_row.tgtype = 5
    AND trigger_row.tgenabled IN ('O', 'A');

  IF signup_trigger_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'profiles_auth_user_delete_cascade_signup_trigger_postcondition_failed';
  END IF;
END;
$migration$;

COMMIT;
