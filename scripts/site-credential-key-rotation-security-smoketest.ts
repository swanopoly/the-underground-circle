/** Static safety contract for the one-time in-database credential key rotation. */

import fs from 'node:fs';

const sql = fs.readFileSync(
  'supabase/migrations/20260806174000_rotate_site_credential_encryption_key.sql',
  'utf8',
);
let assertions = 0;
const check = (condition: boolean, message: string) => {
  assertions += 1;
  if (!condition) throw new Error(`site credential key rotation smoke failed: ${message}`);
};

check(sql.includes('BEGIN;') && sql.includes('COMMIT;'), 'rotation is atomic');
check(
  sql.includes('LOCK TABLE public.circle_site_credentials, public.user_api_keys IN ACCESS EXCLUSIVE MODE'),
  'every pre-existing shared-key ciphertext table is serialized',
);
check(sql.includes("WHERE secret.name = 'ENCRYPTION_KEY'"), 'only the intended vault secret is selected');
check(sql.includes('FOR UPDATE'), 'credential rows are locked during re-encryption');
check(sql.includes('rotated-2026-08-06-security-definer-acl-incident'), 'idempotent rotation marker is present');
check(sql.includes('coalesce(vault_description'), 'completed rotation is skipped on retry');
check(sql.includes('public.site_credential_encryption_key()'), 'old and effective keys come from the application source of truth');
check(sql.includes('public.app_encryption_key()'), 'the user-key encryption source is inventoried before rotation');
check(sql.includes('app_key_uses_vault'), 'a separate app encryption key remains a separate domain');
check(sql.includes('extensions.gen_random_bytes(48)'), 'replacement key has strong database entropy');
check(sql.includes('extensions.pgp_sym_decrypt('), 'old ciphertext is decrypted in database');
check(sql.includes('extensions.pgp_sym_encrypt('), 'plaintext is re-encrypted in database');
check(sql.includes('PERFORM vault.update_secret('), 'vault is updated inside the same transaction');
check(sql.includes('effective_key IS DISTINCT FROM new_key'), 'effective key visibility is verified');
check(sql.includes('credential_key_rotation_verification_failed'), 'every replacement ciphertext is verified');
check(sql.includes('user_api_key_rotation_decrypt_failed'), 'user API/OAuth/wallet ciphertext must decrypt before rotation');
check(sql.includes('UPDATE public.user_api_keys'), 'shared-key user ciphertext is rewrapped in the same transaction');
check(sql.includes('user_api_key_rotation_verification_failed'), 'every replacement user ciphertext is verified');
check(!sql.includes('RAISE NOTICE'), 'keys and plaintext cannot be logged by notices');
check(!sql.includes('RETURNING credential_encrypted'), 'ciphertexts are not returned');

console.log(`site credential key rotation smoke passed (${assertions} assertions)`);
