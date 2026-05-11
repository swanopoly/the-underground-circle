-- Live security hardening for user-provided API keys and circle secrets.
--
-- Goals:
-- 1. A client can only decrypt its own user_api_keys. Edge functions using
--    service_role can still resolve a user's BYOK key for that user's request.
-- 2. Circle integration/site credential secret rows are no longer directly
--    selectable by every circle member. Members can see integration metadata,
--    but direct secret material is limited to the installer/creator/manager.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION app_encryption_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := coalesce(
    nullif(current_setting('app.settings.encryption_key', true), ''),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ENCRYPTION_KEY' LIMIT 1)
  );

  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'encryption_key_missing';
  END IF;

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION app_encryption_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_encryption_key() FROM anon;
REVOKE ALL ON FUNCTION app_encryption_key() FROM authenticated;

CREATE OR REPLACE FUNCTION store_user_api_key(
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    pgp_sym_encrypt(p_api_key, v_passphrase),
    coalesce(nullif(trim(p_label), ''), 'default'),
    nullif(trim(p_endpoint), '')
  )
  ON CONFLICT (user_id, provider, label)
  DO UPDATE SET
    api_key_enc = pgp_sym_encrypt(p_api_key, v_passphrase),
    endpoint = coalesce(nullif(trim(p_endpoint), ''), user_api_keys.endpoint),
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_api_key(
  p_user_id uuid,
  p_provider text,
  p_label text DEFAULT 'default'
)
RETURNS TABLE(api_key text, endpoint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    pgp_sym_decrypt(k.api_key_enc, v_passphrase)::text AS api_key,
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
SET search_path = public
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
    pgp_sym_encrypt(p_api_key, v_passphrase),
    coalesce(nullif(trim(p_label), ''), 'default'),
    nullif(trim(p_endpoint), '')
  )
  ON CONFLICT (user_id, provider, label)
  DO UPDATE SET
    api_key_enc = pgp_sym_encrypt(p_api_key, v_passphrase),
    endpoint = coalesce(nullif(trim(p_endpoint), ''), user_api_keys.endpoint),
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION store_user_api_key(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_user_api_key(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_user_api_key_for_user(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_user_api_key(text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION get_user_api_key(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION store_user_api_key_for_user(uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION store_user_api_key_for_user(uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION store_user_api_key(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_api_key(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION store_user_api_key_for_user(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION is_circle_secret_manager(
  p_circle_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM circle_members cm
      WHERE cm.circle_id = p_circle_id
        AND cm.user_id = p_user_id
        AND cm.role IN ('creator', 'owner', 'admin', 'moderator')
    );
$$;

REVOKE ALL ON FUNCTION is_circle_secret_manager(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_circle_secret_manager(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_circle_secret_manager(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION can_manage_circle_site_credentials(p_circle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_circle_secret_manager(p_circle_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION can_manage_circle_site_credentials(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_manage_circle_site_credentials(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION can_manage_circle_site_credentials(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS circle_integrations_manage_member ON circle_integrations;
CREATE POLICY circle_integrations_manage_member
  ON circle_integrations FOR ALL TO authenticated
  USING (is_circle_secret_manager(circle_id, auth.uid()))
  WITH CHECK (is_circle_secret_manager(circle_id, auth.uid()));

DROP POLICY IF EXISTS circle_integration_secrets_select ON circle_integration_secrets;
DROP POLICY IF EXISTS circle_integration_secrets_select_manager ON circle_integration_secrets;
CREATE POLICY circle_integration_secrets_select_manager
  ON circle_integration_secrets FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR integration_id IN (
      SELECT ci.id
      FROM circle_integrations ci
      WHERE ci.installed_by = auth.uid()
        OR is_circle_secret_manager(ci.circle_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS circle_integration_secrets_manage_member ON circle_integration_secrets;
CREATE POLICY circle_integration_secrets_manage_member
  ON circle_integration_secrets FOR ALL TO authenticated
  USING (
    integration_id IN (
      SELECT ci.id
      FROM circle_integrations ci
      WHERE is_circle_secret_manager(ci.circle_id, auth.uid())
    )
  )
  WITH CHECK (
    integration_id IN (
      SELECT ci.id
      FROM circle_integrations ci
      WHERE is_circle_secret_manager(ci.circle_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS circle_site_credentials_select ON circle_site_credentials;
DROP POLICY IF EXISTS circle_site_credentials_select_manager ON circle_site_credentials;
CREATE POLICY circle_site_credentials_select_manager
  ON circle_site_credentials FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR is_circle_secret_manager(circle_id, auth.uid())
  );

DROP POLICY IF EXISTS circle_site_credentials_manage_member ON circle_site_credentials;
CREATE POLICY circle_site_credentials_manage_member
  ON circle_site_credentials FOR ALL TO authenticated
  USING (is_circle_secret_manager(circle_id, auth.uid()))
  WITH CHECK (is_circle_secret_manager(circle_id, auth.uid()));

-- Stop owner-funded background AI work from running outside an explicit user
-- action. These jobs can be re-enabled later after their functions enforce
-- the same BYOK/owner-allowlist policy as chat and automation-executor.
DO $$
DECLARE
  job record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job IN
      SELECT jobid, schedule, command, database, username
      FROM cron.job
      WHERE jobname IN ('memory_embed_backfill', 'tick_consolidate_memories')
    LOOP
      PERFORM cron.alter_job(
        job_id := job.jobid,
        active := false
      );
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
