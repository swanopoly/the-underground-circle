-- One-time credential key rotation after the former encryption-key helper was
-- found executable by web roles. The key and plaintexts never leave Postgres.
-- A vault-description marker makes a bounded retry idempotent.

BEGIN;

DO $rotation$
DECLARE
  rotation_marker constant text := 'rotated-2026-08-06-security-definer-acl-incident';
  vault_secret_id uuid;
  vault_description text;
  old_key text;
  old_app_key text;
  new_key text;
  effective_key text;
  effective_app_key text;
  app_key_uses_vault boolean;
  credential_row record;
  plaintext_secret text;
BEGIN
  -- Serialize every pre-existing ciphertext consumer of ENCRYPTION_KEY before
  -- replacing the Vault secret. Integration-secret ciphertext is introduced
  -- by a later migration and therefore has no rows at this point in migration
  -- order. Existing store/reveal calls for these two tables will wait.
  LOCK TABLE public.circle_site_credentials, public.user_api_keys IN ACCESS EXCLUSIVE MODE;

  SELECT secret.id, secret.description
  INTO vault_secret_id, vault_description
  FROM vault.secrets AS secret
  WHERE secret.name = 'ENCRYPTION_KEY';

  IF vault_secret_id IS NULL THEN
    RAISE EXCEPTION 'vault_encryption_key_missing';
  END IF;

  IF coalesce(vault_description, '') <> rotation_marker THEN
    old_key := public.site_credential_encryption_key();
    old_app_key := public.app_encryption_key();
    app_key_uses_vault := old_app_key IS NOT DISTINCT FROM old_key;
    new_key := pg_catalog.encode(extensions.gen_random_bytes(48), 'hex');

    IF old_key IS NULL OR pg_catalog.length(old_key) < 32
      OR new_key IS NULL OR pg_catalog.length(new_key) < 64
      OR old_key = new_key
    THEN
      RAISE EXCEPTION 'credential_key_rotation_precondition_failed';
    END IF;

    FOR credential_row IN
      SELECT credential.id, credential.credential_encrypted
      FROM public.circle_site_credentials AS credential
      WHERE credential.credential_encrypted IS NOT NULL
        AND credential.credential_encrypted <> ''
        AND credential.credential_encrypted <> '__local_secret__'
      FOR UPDATE
    LOOP
      plaintext_secret := extensions.pgp_sym_decrypt(
        pg_catalog.decode(credential_row.credential_encrypted, 'base64'),
        old_key
      );
      IF plaintext_secret IS NULL OR plaintext_secret = '' THEN
        RAISE EXCEPTION 'credential_key_rotation_decrypt_failed';
      END IF;

      UPDATE public.circle_site_credentials AS credential
      SET credential_encrypted = pg_catalog.encode(
            extensions.pgp_sym_encrypt(plaintext_secret, new_key),
            'base64'
          ),
          metadata = coalesce(credential.metadata, '{}'::jsonb)
            || jsonb_build_object('vaultVersion', 2),
          updated_at = pg_catalog.clock_timestamp()
      WHERE credential.id = credential_row.id;

      plaintext_secret := NULL;
    END LOOP;

    -- user_api_keys may use a separately configured app.settings key. Only
    -- rewrap it when app_encryption_key() resolves the Vault key being rotated;
    -- otherwise changing these rows would collapse an intentionally separate
    -- encryption domain into the site-credential domain.
    IF app_key_uses_vault THEN
      FOR credential_row IN
        SELECT user_key.id, user_key.api_key_enc
        FROM public.user_api_keys AS user_key
        FOR UPDATE
      LOOP
        plaintext_secret := extensions.pgp_sym_decrypt(
          credential_row.api_key_enc,
          old_app_key
        );
        IF plaintext_secret IS NULL OR plaintext_secret = '' THEN
          RAISE EXCEPTION 'user_api_key_rotation_decrypt_failed';
        END IF;

        UPDATE public.user_api_keys AS user_key
        SET api_key_enc = extensions.pgp_sym_encrypt(plaintext_secret, new_key),
            updated_at = pg_catalog.clock_timestamp()
        WHERE user_key.id = credential_row.id;

        plaintext_secret := NULL;
      END LOOP;
    END IF;

    PERFORM vault.update_secret(
      vault_secret_id,
      new_key,
      'ENCRYPTION_KEY',
      rotation_marker,
      NULL
    );

    -- Verify that the application helper observes the replacement before
    -- committing and that every migrated ciphertext decrypts with it.
    effective_key := public.site_credential_encryption_key();
    IF effective_key IS DISTINCT FROM new_key THEN
      RAISE EXCEPTION 'credential_key_rotation_visibility_failed';
    END IF;

    effective_app_key := public.app_encryption_key();
    IF app_key_uses_vault AND effective_app_key IS DISTINCT FROM new_key THEN
      RAISE EXCEPTION 'user_api_key_rotation_visibility_failed';
    ELSIF NOT app_key_uses_vault AND effective_app_key IS DISTINCT FROM old_app_key THEN
      RAISE EXCEPTION 'separate_app_encryption_key_changed_during_site_rotation';
    END IF;

    FOR credential_row IN
      SELECT credential.credential_encrypted
      FROM public.circle_site_credentials AS credential
      WHERE credential.credential_encrypted IS NOT NULL
        AND credential.credential_encrypted <> ''
        AND credential.credential_encrypted <> '__local_secret__'
    LOOP
      plaintext_secret := extensions.pgp_sym_decrypt(
        pg_catalog.decode(credential_row.credential_encrypted, 'base64'),
        effective_key
      );
      IF plaintext_secret IS NULL OR plaintext_secret = '' THEN
        RAISE EXCEPTION 'credential_key_rotation_verification_failed';
      END IF;
      plaintext_secret := NULL;
    END LOOP;

    IF app_key_uses_vault THEN
      FOR credential_row IN
        SELECT user_key.api_key_enc
        FROM public.user_api_keys AS user_key
      LOOP
        plaintext_secret := extensions.pgp_sym_decrypt(
          credential_row.api_key_enc,
          effective_app_key
        );
        IF plaintext_secret IS NULL OR plaintext_secret = '' THEN
          RAISE EXCEPTION 'user_api_key_rotation_verification_failed';
        END IF;
        plaintext_secret := NULL;
      END LOOP;
    END IF;

    old_key := NULL;
    old_app_key := NULL;
    new_key := NULL;
    effective_key := NULL;
    effective_app_key := NULL;
  END IF;
END;
$rotation$;

COMMIT;
