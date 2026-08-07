-- Seal circle integration secrets behind server-side encryption and narrow
-- RPCs. The historical table stored browser-generated base64 plaintext in a
-- column named value_encrypted, and its SELECT policy continued to trust the
-- row creator / integration installer after their manager role changed.
--
-- This migration deliberately keeps a service-role-only compatibility view at
-- the historical public table name. Existing Edge functions can keep reading
-- base64 values while the actual ciphertext remains in a non-exposed schema.
-- Browser clients may only save, list key names, or reveal values through the
-- JWT-bound manager RPCs below.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.circle_integration_secrets') IS NULL THEN
    RAISE EXCEPTION 'circle_integration_secrets_missing';
  END IF;

  IF pg_catalog.to_regprocedure('public.app_encryption_key()') IS NULL
    OR pg_catalog.to_regprocedure('extensions.pgp_sym_encrypt(text,text,text)') IS NULL
    OR pg_catalog.to_regprocedure('extensions.pgp_sym_decrypt(bytea,text)') IS NULL
  THEN
    RAISE EXCEPTION 'circle_integration_secret_encryption_dependency_missing';
  END IF;
END;
$preflight$;

LOCK TABLE public.circle_integration_secrets IN ACCESS EXCLUSIVE MODE;

-- Resolve the key before changing any data. app_encryption_key() fails closed
-- when the server-side setting / Vault secret is unavailable.
DO $encrypt_legacy_rows$
DECLARE
  secret_row record;
  passphrase text := public.app_encryption_key();
  plaintext text;
  ciphertext text;
BEGIN
  FOR secret_row IN
    SELECT secret.id, secret.value_encrypted
    FROM public.circle_integration_secrets AS secret
    ORDER BY secret.id
    FOR UPDATE
  LOOP
    BEGIN
      plaintext := pg_catalog.convert_from(
        pg_catalog.decode(secret_row.value_encrypted, 'base64'),
        'UTF8'
      );
    EXCEPTION WHEN OTHERS THEN
      -- Identify only the row that needs operator repair. Never log the
      -- encoded value, plaintext, passphrase, or ciphertext.
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = pg_catalog.format(
          'circle_integration_secret_legacy_decode_failed:%s',
          secret_row.id
        );
    END;

    ciphertext := 'pgp:v1:' || pg_catalog.translate(
      pg_catalog.encode(
        extensions.pgp_sym_encrypt(
          plaintext,
          passphrase,
          'cipher-algo=aes256,compress-algo=1'
        ),
        'base64'
      ),
      E'\n\r',
      ''
    );

    IF extensions.pgp_sym_decrypt(
      pg_catalog.decode(pg_catalog.substr(ciphertext, 8), 'base64'),
      passphrase
    ) IS DISTINCT FROM plaintext
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '22000',
        MESSAGE = pg_catalog.format(
          'circle_integration_secret_encryption_verification_failed:%s',
          secret_row.id
        );
    END IF;

    UPDATE public.circle_integration_secrets AS secret
    SET value_encrypted = ciphertext
    WHERE secret.id = secret_row.id;
  END LOOP;
END;
$encrypt_legacy_rows$;

CREATE SCHEMA IF NOT EXISTS integration_secrets_private;
REVOKE ALL ON SCHEMA integration_secrets_private FROM PUBLIC;
REVOKE ALL ON SCHEMA integration_secrets_private FROM anon;
REVOKE ALL ON SCHEMA integration_secrets_private FROM authenticated;
REVOKE ALL ON SCHEMA integration_secrets_private FROM service_role;

-- Historical policies trusted created_by / installed_by. Remove every policy
-- from the backing relation before moving it out of the exposed API schema.
DO $drop_secret_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policy.polname
    FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'public.circle_integration_secrets'::pg_catalog.regclass
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.circle_integration_secrets',
      policy_row.polname
    );
  END LOOP;
END;
$drop_secret_policies$;

ALTER TABLE public.circle_integration_secrets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.circle_integration_secrets SET SCHEMA integration_secrets_private;
ALTER TABLE integration_secrets_private.circle_integration_secrets
  RENAME TO circle_integration_secret_ciphertexts;

REVOKE ALL ON TABLE integration_secrets_private.circle_integration_secret_ciphertexts FROM PUBLIC;
REVOKE ALL ON TABLE integration_secrets_private.circle_integration_secret_ciphertexts FROM anon;
REVOKE ALL ON TABLE integration_secrets_private.circle_integration_secret_ciphertexts FROM authenticated;
REVOKE ALL ON TABLE integration_secrets_private.circle_integration_secret_ciphertexts FROM service_role;

COMMENT ON TABLE integration_secrets_private.circle_integration_secret_ciphertexts IS
  'Server-only pgcrypto ciphertext for circle integrations. Use the public manager RPCs or the service-only compatibility view.';

-- Existing Edge functions use a service-role client and decode the historical
-- base64 wire format. Preserve that server-only contract without exposing the
-- backing ciphertext, decryption key, or plaintext view to browser roles.
CREATE VIEW public.circle_integration_secrets
WITH (security_barrier = true)
AS
SELECT
  secret.id,
  secret.integration_id,
  secret.key,
  pg_catalog.translate(
    pg_catalog.encode(
      pg_catalog.convert_to(
        extensions.pgp_sym_decrypt(
          pg_catalog.decode(pg_catalog.substr(secret.value_encrypted, 8), 'base64'),
          public.app_encryption_key()
        ),
        'UTF8'
      ),
      'base64'
    ),
    E'\n\r',
    ''
  ) AS value_encrypted,
  secret.created_by,
  secret.created_at,
  secret.updated_at
FROM integration_secrets_private.circle_integration_secret_ciphertexts AS secret
WHERE pg_catalog.left(secret.value_encrypted, 7) = 'pgp:v1:';

REVOKE ALL ON TABLE public.circle_integration_secrets FROM PUBLIC;
REVOKE ALL ON TABLE public.circle_integration_secrets FROM anon;
REVOKE ALL ON TABLE public.circle_integration_secrets FROM authenticated;
REVOKE ALL ON TABLE public.circle_integration_secrets FROM service_role;
GRANT SELECT ON TABLE public.circle_integration_secrets TO service_role;

COMMENT ON VIEW public.circle_integration_secrets IS
  'Service-role compatibility projection for existing Edge readers; browser roles have no privileges.';

CREATE OR REPLACE FUNCTION public.save_circle_integration_secrets(
  p_integration_id uuid,
  p_secrets jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, integration_secrets_private, extensions
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  caller_role text := auth.role();
  target_circle_id uuid;
  passphrase text;
  secret_count integer;
  secret_entry record;
BEGIN
  IF caller_role IS DISTINCT FROM 'service_role' AND caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT integration.circle_id
  INTO target_circle_id
  FROM public.circle_integrations AS integration
  WHERE integration.id = p_integration_id;

  IF target_circle_id IS NULL
    OR (
      caller_role IS DISTINCT FROM 'service_role'
      AND NOT EXISTS (
        SELECT 1
        FROM public.circle_members AS membership
        WHERE membership.circle_id = target_circle_id
          AND membership.user_id = caller_id
          AND membership.role IN ('creator', 'owner', 'admin', 'moderator')
      )
    )
  THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_secrets IS NULL OR pg_catalog.jsonb_typeof(p_secrets) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_secrets_object';
  END IF;

  IF pg_catalog.octet_length(p_secrets::text) > 1048576 THEN
    RAISE EXCEPTION 'secrets_object_too_large';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO secret_count
  FROM pg_catalog.jsonb_each(p_secrets);

  IF secret_count > 64 THEN
    RAISE EXCEPTION 'too_many_integration_secrets';
  END IF;

  IF secret_count = 0 THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(p_secrets) AS item
    WHERE pg_catalog.jsonb_typeof(item.value) IS DISTINCT FROM 'string'
      OR item.key !~ '^[A-Za-z0-9_.-]{1,128}$'
      OR item.key IN ('__proto__', 'prototype', 'constructor')
      OR pg_catalog.octet_length(item.value #>> '{}') > 262144
      OR pg_catalog.btrim(item.value #>> '{}') = ''
  )
  THEN
    RAISE EXCEPTION 'invalid_integration_secret_entry';
  END IF;

  passphrase := public.app_encryption_key();

  FOR secret_entry IN
    SELECT item.key, item.value #>> '{}' AS plaintext
    FROM pg_catalog.jsonb_each(p_secrets) AS item
    ORDER BY item.key
  LOOP
    INSERT INTO integration_secrets_private.circle_integration_secret_ciphertexts (
      integration_id,
      key,
      value_encrypted,
      created_by
    )
    VALUES (
      p_integration_id,
      secret_entry.key,
      'pgp:v1:' || pg_catalog.translate(
        pg_catalog.encode(
          extensions.pgp_sym_encrypt(
            secret_entry.plaintext,
            passphrase,
            'cipher-algo=aes256,compress-algo=1'
          ),
          'base64'
        ),
        E'\n\r',
        ''
      ),
      caller_id
    )
    ON CONFLICT (integration_id, key)
    DO UPDATE SET
      value_encrypted = EXCLUDED.value_encrypted,
      updated_at = pg_catalog.statement_timestamp();
  END LOOP;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_circle_integration_secret_keys(
  p_integration_id uuid
)
RETURNS TABLE(key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, integration_secrets_private
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  caller_role text := auth.role();
  target_circle_id uuid;
BEGIN
  IF caller_role IS DISTINCT FROM 'service_role' AND caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT integration.circle_id
  INTO target_circle_id
  FROM public.circle_integrations AS integration
  WHERE integration.id = p_integration_id;

  IF target_circle_id IS NULL
    OR (
      caller_role IS DISTINCT FROM 'service_role'
      AND NOT EXISTS (
        SELECT 1
        FROM public.circle_members AS membership
        WHERE membership.circle_id = target_circle_id
          AND membership.user_id = caller_id
          AND membership.role IN ('creator', 'owner', 'admin', 'moderator')
      )
    )
  THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT secret.key
  FROM integration_secrets_private.circle_integration_secret_ciphertexts AS secret
  WHERE secret.integration_id = p_integration_id
  ORDER BY secret.key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_circle_integration_secret_values(
  p_integration_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, integration_secrets_private, extensions
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  caller_role text := auth.role();
  target_circle_id uuid;
  passphrase text;
  result jsonb;
BEGIN
  IF caller_role IS DISTINCT FROM 'service_role' AND caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT integration.circle_id
  INTO target_circle_id
  FROM public.circle_integrations AS integration
  WHERE integration.id = p_integration_id;

  IF target_circle_id IS NULL
    OR (
      caller_role IS DISTINCT FROM 'service_role'
      AND NOT EXISTS (
        SELECT 1
        FROM public.circle_members AS membership
        WHERE membership.circle_id = target_circle_id
          AND membership.user_id = caller_id
          AND membership.role IN ('creator', 'owner', 'admin', 'moderator')
      )
    )
  THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  passphrase := public.app_encryption_key();

  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(
      secret.key,
      extensions.pgp_sym_decrypt(
        pg_catalog.decode(pg_catalog.substr(secret.value_encrypted, 8), 'base64'),
        passphrase
      )
      ORDER BY secret.key
    ),
    '{}'::jsonb
  )
  INTO result
  FROM integration_secrets_private.circle_integration_secret_ciphertexts AS secret
  WHERE secret.integration_id = p_integration_id
    AND pg_catalog.left(secret.value_encrypted, 7) = 'pgp:v1:';

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_circle_integration_secrets(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_circle_integration_secrets(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.save_circle_integration_secrets(uuid, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.save_circle_integration_secrets(uuid, jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.save_circle_integration_secrets(uuid, jsonb)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_circle_integration_secret_keys(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_circle_integration_secret_keys(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_circle_integration_secret_keys(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.list_circle_integration_secret_keys(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.list_circle_integration_secret_keys(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_circle_integration_secret_values(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_circle_integration_secret_values(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_circle_integration_secret_values(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_circle_integration_secret_values(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_circle_integration_secret_values(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.save_circle_integration_secrets(uuid, jsonb) IS
  'Current circle managers may store bounded integration values; caller identity comes only from auth.uid and encryption occurs in database.';
COMMENT ON FUNCTION public.list_circle_integration_secret_keys(uuid) IS
  'Current circle managers may list configured key names without reading ciphertext.';
COMMENT ON FUNCTION public.get_circle_integration_secret_values(uuid) IS
  'Current circle managers may retrieve integration values through an audited RPC; ciphertext and encryption keys never leave the database.';

NOTIFY pgrst, 'reload schema';

COMMIT;
