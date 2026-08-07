/**
 * Static contract for the circle integration secret encryption/RPC boundary.
 *
 * This smoke intentionally uses only source text. Applying the migration needs
 * a linked database with ENCRYPTION_KEY already present and is a separate,
 * explicitly reviewed release step.
 */

import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260806192000_circle_integration_secret_rpc_hardening.sql',
  'utf8',
);
const revealSqlFix = readFileSync(
  'supabase/migrations/20260806194500_circle_integration_secret_reveal_sql_fix.sql',
  'utf8',
);
const client = readFileSync('src/lib/circleIntegrations.ts', 'utf8');
const awsConnector = readFileSync('src/lib/integrations/connectors/aws.ts', 'utf8');

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`circle integration secret security smoke failed: ${message}`);
}

function section(start: string, end: string): string {
  const startAt = migration.indexOf(start);
  const endAt = migration.indexOf(end, startAt + start.length);
  check(startAt >= 0, `section starts: ${start}`);
  check(endAt > startAt, `section ends: ${end}`);
  return migration.slice(startAt, endAt);
}

const saveRpc = section(
  'CREATE OR REPLACE FUNCTION public.save_circle_integration_secrets(',
  'CREATE OR REPLACE FUNCTION public.list_circle_integration_secret_keys(',
);
const listRpc = section(
  'CREATE OR REPLACE FUNCTION public.list_circle_integration_secret_keys(',
  'CREATE OR REPLACE FUNCTION public.get_circle_integration_secret_values(',
);
const revealRpc = section(
  'CREATE OR REPLACE FUNCTION public.get_circle_integration_secret_values(',
  'REVOKE ALL ON FUNCTION public.save_circle_integration_secrets',
);

console.log('Encrypted backing store');
check(migration.includes('BEGIN;') && migration.includes('COMMIT;'), 'migration is atomic');
check(
  migration.includes('LOCK TABLE public.circle_integration_secrets IN ACCESS EXCLUSIVE MODE'),
  'legacy writes are serialized during conversion',
);
check(migration.includes('public.app_encryption_key()'), 'encryption key comes from the server-side source of truth');
check(migration.includes('extensions.pgp_sym_encrypt('), 'legacy and new values use pgcrypto encryption');
check(migration.includes("'cipher-algo=aes256,compress-algo=1'"), 'encryption requests AES-256');
check(migration.includes('pg_catalog.convert_from('), 'legacy browser base64 is decoded as UTF-8 in database');
check(migration.includes('FOR UPDATE'), 'legacy rows are locked before re-encryption');
check(migration.includes("'pgp:v1:'"), 'ciphertexts carry an explicit format marker');
check(migration.includes('circle_integration_secret_encryption_verification_failed'), 'each migrated row is decrypt-verified before replacement');
check(!migration.includes('RAISE NOTICE'), 'migration cannot log plaintext or keys through notices');
check(!migration.includes('RETURNING value_encrypted'), 'ciphertexts are never returned during writes');
check(!migration.includes('pg_catalog.coalesce('), 'COALESCE remains valid SQL syntax instead of a catalog function call');
check(revealSqlFix.includes('SELECT COALESCE('), 'forward migration repairs the live reveal RPC');
check(!revealSqlFix.includes('pg_catalog.coalesce('), 'forward migration does not restore the invalid catalog qualification');

console.log('Non-exposed storage and service compatibility');
check(migration.includes('ALTER TABLE public.circle_integration_secrets SET SCHEMA integration_secrets_private'), 'ciphertext table leaves the exposed API schema');
check(migration.includes('FORCE ROW LEVEL SECURITY'), 'ciphertext table keeps force-RLS defense in depth');
check(migration.includes('FROM pg_catalog.pg_policy'), 'all historical creator/installer policies are enumerated');
check(migration.includes("'DROP POLICY %I ON public.circle_integration_secrets'"), 'all historical policies are removed');
for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
  check(
    migration.includes(`REVOKE ALL ON TABLE integration_secrets_private.circle_integration_secret_ciphertexts FROM ${role}`),
    `direct ciphertext access is revoked from ${role}`,
  );
}
check(migration.includes('CREATE VIEW public.circle_integration_secrets'), 'historical server read name becomes a compatibility view');
check(migration.includes('WITH (security_barrier = true)'), 'compatibility view is a security barrier');
check(migration.includes('extensions.pgp_sym_decrypt('), 'compatibility output is decrypted only in database');
check(migration.includes('GRANT SELECT ON TABLE public.circle_integration_secrets TO service_role'), 'only service role gets compatibility SELECT');
check(!migration.includes('GRANT SELECT ON TABLE public.circle_integration_secrets TO authenticated'), 'authenticated browser role cannot select compatibility values');
check(!migration.includes('GRANT SELECT ON TABLE public.circle_integration_secrets TO anon'), 'anonymous browser role cannot select compatibility values');

console.log('JWT-bound manager RPCs');
for (const [name, rpc] of [
  ['save', saveRpc],
  ['list', listRpc],
  ['reveal', revealRpc],
] as const) {
  check(rpc.includes('auth.uid()'), `${name} RPC derives caller identity from auth.uid`);
  check(rpc.includes('auth.role()'), `${name} RPC reserves trusted service behavior by signed role`);
  check(rpc.includes('FROM public.circle_members AS membership'), `${name} RPC verifies current membership`);
  check(rpc.includes('membership.user_id = caller_id'), `${name} RPC binds membership to the JWT subject`);
  check(rpc.includes("membership.role IN ('creator', 'owner', 'admin', 'moderator')"), `${name} RPC requires a current manager role`);
  check(rpc.includes("RAISE EXCEPTION 'not_authorized'"), `${name} RPC fails closed`);
  check(rpc.includes('SECURITY DEFINER'), `${name} RPC uses a controlled definer boundary`);
  check(rpc.includes('SET search_path = pg_catalog, public, integration_secrets_private'), `${name} RPC has a fixed search path`);
  check(!rpc.includes('installed_by = caller_id'), `${name} RPC never trusts the historical installer`);
  check(!rpc.includes('created_by = caller_id OR'), `${name} RPC never authorizes the historical row creator`);
  check(!rpc.includes('p_user_id'), `${name} RPC accepts no caller-selected user identity`);
}
check(saveRpc.includes('pg_catalog.octet_length(p_secrets::text) > 1048576'), 'save payload has a total size cap');
check(saveRpc.includes('secret_count > 64'), 'save payload has a key-count cap');
check(saveRpc.includes("item.key !~ '^[A-Za-z0-9_.-]{1,128}$'"), 'secret key names use a strict allowlist');
check(saveRpc.includes("item.key IN ('__proto__', 'prototype', 'constructor')"), 'prototype-polluting names are rejected');
check(saveRpc.includes('pg_catalog.octet_length(item.value #>>'), 'individual values have a size cap');

for (const signature of [
  'public.save_circle_integration_secrets(uuid, jsonb)',
  'public.list_circle_integration_secret_keys(uuid)',
  'public.get_circle_integration_secret_values(uuid)',
]) {
  check(migration.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`), `${signature} revokes default PUBLIC execution`);
  check(migration.includes(`REVOKE ALL ON FUNCTION ${signature} FROM anon`), `${signature} rejects anonymous execution`);
  check(migration.includes(`GRANT EXECUTE ON FUNCTION ${signature}`), `${signature} has an exact reviewed execute grant`);
}

console.log('Browser client boundary');
check(!client.includes('function encodeSecret('), 'browser no longer implements secret encoding');
check(!client.includes('function decodeSecret('), 'browser no longer implements secret decoding');
check(!client.includes(".from('circle_integration_secrets')"), 'browser never reads or writes the secret relation directly');
check(!client.includes('value_encrypted'), 'browser never selects or parses ciphertext');
check(!client.includes('btoa(') && !client.includes('atob('), 'circle integration module has no base64 secret path');
check(client.includes("supabase.rpc('save_circle_integration_secrets'"), 'browser saves through the bounded RPC');
check(client.includes("supabase.rpc('list_circle_integration_secret_keys'"), 'browser lists key names through the bounded RPC');
check(client.includes("supabase.rpc('get_circle_integration_secret_values'"), 'browser reveal uses the manager RPC');
check(client.includes('Object.create(null)'), 'revealed values are copied into a null-prototype map');
check(!client.includes('created_by: userId'), 'browser never claims secret-row ownership');
check(!awsConnector.includes(".from('circle_integration_secrets')"), 'AWS connector has no direct secret-table write');
check(awsConnector.includes("import { saveCircleIntegrationSecrets } from '../../circleIntegrations'"), 'AWS connector reuses the canonical secret owner');
check(awsConnector.includes('secrets: { external_id: externalId }'), 'AWS external ID uses the encrypted save RPC path');
check(!awsConnector.includes('value_encrypted:'), 'AWS connector never supplies fake ciphertext');

console.log(`circle integration secret security smoke passed (${assertions} assertions)`);
