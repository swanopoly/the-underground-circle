-- Restore get_user_api_key RPC for clients that already have store_user_api_key and list_user_api_keys
-- but are missing the secret-read function in the deployed database.

CREATE OR REPLACE FUNCTION get_user_api_key(
  p_user_id uuid,
  p_provider text,
  p_label text DEFAULT 'default'
)
RETURNS TABLE(api_key text, endpoint text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_passphrase text;
BEGIN
  v_passphrase := coalesce(
    current_setting('app.settings.encryption_key', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ENCRYPTION_KEY' LIMIT 1),
    'tuc-default-enc-key-change-me'
  );

  RETURN QUERY
  SELECT
    pgp_sym_decrypt(k.api_key_enc, v_passphrase)::text AS api_key,
    k.endpoint
  FROM user_api_keys k
  WHERE k.user_id = p_user_id
    AND k.provider = p_provider
    AND (p_label IS NULL OR k.label = p_label)
    AND k.is_active = true
  LIMIT 1;
END;
$$;
