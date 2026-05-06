-- Vault operational controls.
--
-- Adds RPCs for updating credential policy/metadata without rotating the
-- secret, plus a first-class test-result log for automation readiness.

ALTER TABLE circle_site_credential_access_log
  DROP CONSTRAINT IF EXISTS circle_site_credential_access_log_action_check;

ALTER TABLE circle_site_credential_access_log
  ADD CONSTRAINT circle_site_credential_access_log_action_check
  CHECK (action IN ('store', 'list', 'reveal', 'delete', 'use', 'rotate', 'update', 'test'));

CREATE OR REPLACE FUNCTION update_circle_site_credential_controls(
  p_credential_id uuid,
  p_site_url text DEFAULT NULL,
  p_login_url text DEFAULT NULL,
  p_username text DEFAULT NULL,
  p_label text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_access_policy jsonb DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_rotation_due_at timestamptz DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_set_site_url boolean DEFAULT false,
  p_set_login_url boolean DEFAULT false,
  p_set_username boolean DEFAULT false,
  p_set_label boolean DEFAULT false,
  p_set_expires_at boolean DEFAULT false,
  p_set_rotation_due_at boolean DEFAULT false,
  p_set_is_active boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row circle_site_credentials;
  v_next_label text;
BEGIN
  SELECT *
  INTO v_row
  FROM circle_site_credentials
  WHERE id = p_credential_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'credential_not_found';
  END IF;

  IF NOT can_manage_circle_site_credentials(v_row.circle_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_next_label := coalesce(nullif(trim(coalesce(p_label, '')), ''), v_row.label);

  UPDATE circle_site_credentials
  SET
    site_url = CASE WHEN p_set_site_url THEN nullif(trim(coalesce(p_site_url, '')), '') ELSE site_url END,
    login_url = CASE WHEN p_set_login_url THEN nullif(trim(coalesce(p_login_url, '')), '') ELSE login_url END,
    username = CASE WHEN p_set_username THEN nullif(trim(coalesce(p_username, '')), '') ELSE username END,
    label = CASE WHEN p_set_label THEN v_next_label ELSE label END,
    metadata = CASE
      WHEN p_metadata IS NULL THEN coalesce(metadata, '{}'::jsonb)
      ELSE coalesce(metadata, '{}'::jsonb) || p_metadata
    END,
    access_policy = coalesce(p_access_policy, access_policy, '{"require_approval": true}'::jsonb),
    expires_at = CASE WHEN p_set_expires_at THEN p_expires_at ELSE expires_at END,
    rotation_due_at = CASE WHEN p_set_rotation_due_at THEN p_rotation_due_at ELSE rotation_due_at END,
    is_active = CASE WHEN p_set_is_active THEN coalesce(p_is_active, true) ELSE is_active END,
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO circle_site_credential_access_log (
    credential_id,
    circle_id,
    actor_id,
    action,
    purpose,
    success,
    metadata
  )
  VALUES (
    v_row.id,
    v_row.circle_id,
    auth.uid(),
    'update',
    'vault_controls_update',
    true,
    jsonb_build_object('platform', v_row.platform, 'label', v_row.label)
  );

  RETURN circle_site_credential_public_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION record_circle_site_credential_test_result(
  p_credential_id uuid,
  p_success boolean,
  p_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row circle_site_credentials;
  v_result jsonb;
BEGIN
  SELECT *
  INTO v_row
  FROM circle_site_credentials
  WHERE id = p_credential_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'credential_not_found';
  END IF;

  IF NOT can_manage_circle_site_credentials(v_row.circle_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_result := jsonb_build_object(
    'lastTestedAt', now(),
    'lastTestSuccess', coalesce(p_success, false),
    'lastTestMessage', p_message
  ) || coalesce(p_metadata, '{}'::jsonb);

  UPDATE circle_site_credentials
  SET
    metadata = coalesce(metadata, '{}'::jsonb) || v_result,
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO circle_site_credential_access_log (
    credential_id,
    circle_id,
    actor_id,
    action,
    purpose,
    success,
    metadata
  )
  VALUES (
    v_row.id,
    v_row.circle_id,
    auth.uid(),
    'test',
    'vault_connection_test',
    coalesce(p_success, false),
    v_result || jsonb_build_object('platform', v_row.platform, 'label', v_row.label)
  );

  RETURN circle_site_credential_public_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION update_circle_site_credential_controls(
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  timestamptz,
  timestamptz,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION record_circle_site_credential_test_result(
  uuid,
  boolean,
  text,
  jsonb
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
