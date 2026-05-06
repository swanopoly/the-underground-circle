-- Vault security hardening helpers.
--
-- These helpers are intentionally additive. They do not reveal, decrypt, or
-- re-encrypt secrets. They only clean expired automation grants stored in
-- metadata and log that maintenance happened.

CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_created_by
  ON circle_site_credentials(circle_id, created_by);

CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_last_used
  ON circle_site_credentials(circle_id, last_used_at)
  WHERE is_active AND last_used_at IS NOT NULL;

CREATE OR REPLACE FUNCTION vault_grant_not_expired(p_grant jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_expires_at text;
BEGIN
  v_expires_at := nullif(coalesce(p_grant->>'expiresAt', p_grant->>'expires_at', ''), '');
  IF v_expires_at IS NULL THEN
    RETURN true;
  END IF;

  BEGIN
    RETURN v_expires_at::timestamptz > now();
  EXCEPTION WHEN others THEN
    -- Invalid timestamps should not accidentally revoke access. The app can
    -- surface these as malformed grants for manual cleanup.
    RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION prune_expired_circle_site_credential_grants(
  p_circle_id uuid,
  p_credential_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row circle_site_credentials;
  v_before integer;
  v_after integer;
  v_removed_total integer := 0;
  v_next_agent_grants jsonb;
  v_next_automation_grants jsonb;
BEGIN
  IF NOT can_manage_circle_site_credentials(p_circle_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  FOR v_row IN
    SELECT *
    FROM circle_site_credentials
    WHERE circle_id = p_circle_id
      AND (p_credential_id IS NULL OR id = p_credential_id)
    FOR UPDATE
  LOOP
    SELECT count(*)::integer
      INTO v_before
      FROM jsonb_array_elements(coalesce(v_row.metadata->'agentGrants', '[]'::jsonb)) grant_item
      WHERE NOT vault_grant_not_expired(grant_item);

    SELECT coalesce(jsonb_agg(grant_item), '[]'::jsonb)
      INTO v_next_agent_grants
      FROM jsonb_array_elements(coalesce(v_row.metadata->'agentGrants', '[]'::jsonb)) grant_item
      WHERE vault_grant_not_expired(grant_item);

    SELECT count(*)::integer
      INTO v_after
      FROM jsonb_array_elements(coalesce(v_row.metadata->'automationGrants', '[]'::jsonb)) grant_item
      WHERE NOT vault_grant_not_expired(grant_item);

    SELECT coalesce(jsonb_agg(grant_item), '[]'::jsonb)
      INTO v_next_automation_grants
      FROM jsonb_array_elements(coalesce(v_row.metadata->'automationGrants', '[]'::jsonb)) grant_item
      WHERE vault_grant_not_expired(grant_item);

    IF (v_before + v_after) > 0 THEN
      UPDATE circle_site_credentials
      SET
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'agentGrants', v_next_agent_grants,
            'automationGrants', v_next_automation_grants,
            'automationAccessVersion', 1,
            'expiredGrantPrunedAt', now(),
            'expiredGrantPrunedBy', auth.uid()
          ),
        updated_at = now()
      WHERE id = v_row.id;

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
        'vault_expired_grant_prune',
        true,
        jsonb_build_object(
          'platform', v_row.platform,
          'label', v_row.label,
          'removedGrantCount', v_before + v_after
        )
      );

      v_removed_total := v_removed_total + v_before + v_after;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'removedGrantCount', v_removed_total,
    'circleId', p_circle_id,
    'credentialId', p_credential_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION vault_grant_not_expired(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION prune_expired_circle_site_credential_grants(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
