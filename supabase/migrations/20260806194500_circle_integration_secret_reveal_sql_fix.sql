-- Fix the hardened secret-reveal RPC after database lint identified an
-- invalid schema qualification on the COALESCE SQL expression. PostgreSQL
-- implements COALESCE as syntax, not as a schema-qualified catalog function.

BEGIN;

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

REVOKE ALL ON FUNCTION public.get_circle_integration_secret_values(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_circle_integration_secret_values(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_circle_integration_secret_values(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_circle_integration_secret_values(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_circle_integration_secret_values(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_circle_integration_secret_values(uuid) IS
  'Current circle managers may retrieve integration values through an audited RPC; ciphertext and encryption keys never leave the database.';

NOTIFY pgrst, 'reload schema';

COMMIT;
