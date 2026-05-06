-- Fix `function pgp_sym_encrypt(text, text) does not exist`.
--
-- Root cause: in Supabase, the pgcrypto extension installs into the
-- `extensions` schema (project default), but `store_user_api_key`,
-- `get_user_api_key`, and `store_user_api_key_for_user` were defined
-- with `SET search_path = public` so unqualified `pgp_sym_encrypt(...)`
-- and `pgp_sym_decrypt(...)` calls couldn't resolve the function.
--
-- Fix: schema-qualify every pgcrypto call as `extensions.pgp_sym_*`.
-- This is the Supabase-recommended pattern and survives any future
-- search_path changes without further breakage.
--
-- Also includes a defensive `CREATE EXTENSION IF NOT EXISTS pgcrypto
-- WITH SCHEMA extensions;` in case the extension was created in a
-- different schema or not at all.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── store_user_api_key (caller must be the user via auth.uid()) ────────────

CREATE OR REPLACE FUNCTION store_user_api_key(
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
  v_user_id uuid;
  v_passphrase text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_passphrase := app_encryption_key();

  INSERT INTO user_api_keys (user_id, provider, api_key_enc, label, endpoint)
  VALUES (
    v_user_id,
    lower(trim(p_provider)),
    extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
    coalesce(nullif(trim(p_label), ''), 'default'),
    nullif(trim(p_endpoint), '')
  )
  ON CONFLICT (user_id, provider, label)
  DO UPDATE SET
    api_key_enc = extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
    endpoint = coalesce(nullif(trim(p_endpoint), ''), user_api_keys.endpoint),
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── get_user_api_key (decrypts — service role or owner) ───────────────────

CREATE OR REPLACE FUNCTION get_user_api_key(
  p_user_id uuid,
  p_provider text,
  p_label text DEFAULT 'default'
)
RETURNS TABLE(api_key text, endpoint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_passphrase text;
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_passphrase := app_encryption_key();

  RETURN QUERY
  SELECT
    extensions.pgp_sym_decrypt(k.api_key_enc, v_passphrase)::text AS api_key,
    k.endpoint
  FROM user_api_keys k
  WHERE k.user_id = p_user_id
    AND k.provider = lower(trim(p_provider))
    AND (p_label IS NULL OR k.label = p_label)
    AND k.is_active = true
  ORDER BY k.updated_at DESC
  LIMIT 1;
END;
$$;

-- ── store_user_api_key_for_user (service role only — used by edge fns) ────

CREATE OR REPLACE FUNCTION store_user_api_key_for_user(
  p_user_id uuid,
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
  v_passphrase text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_only';
  END IF;

  v_passphrase := app_encryption_key();

  INSERT INTO user_api_keys (user_id, provider, api_key_enc, label, endpoint)
  VALUES (
    p_user_id,
    lower(trim(p_provider)),
    extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
    coalesce(nullif(trim(p_label), ''), 'default'),
    nullif(trim(p_endpoint), '')
  )
  ON CONFLICT (user_id, provider, label)
  DO UPDATE SET
    api_key_enc = extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
    endpoint = coalesce(nullif(trim(p_endpoint), ''), user_api_keys.endpoint),
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Re-establish the same revoke posture as the previous hardening migration.
REVOKE ALL ON FUNCTION store_user_api_key(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_user_api_key(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_user_api_key_for_user(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_user_api_key(text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION get_user_api_key(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION store_user_api_key_for_user(uuid, text, text, text, text) FROM anon;

NOTIFY pgrst, 'reload schema';
