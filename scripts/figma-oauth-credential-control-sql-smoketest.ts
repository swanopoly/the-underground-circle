/** Source contract for the Figma OAuth credential and callback control plane. */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260813200000_figma_oauth_credential_control.sql"),
  "utf8",
);
const consolidated = fs.readFileSync(path.join(root, "docs", "RUN_THIS_SQL.sql"), "utf8");

let assertions = 0;
function check(value: unknown, message: string): void {
  assertions += 1;
  if (!value) throw new Error(`Figma OAuth credential SQL smoke failed: ${message}`);
}

for (const marker of [
  "CHECK (provider IN ('google', 'microsoft', 'figma'))",
  "ALTER TABLE public.oauth_provider_credentials FORCE ROW LEVEL SECURITY",
  "ALTER TABLE public.figma_oauth_states FORCE ROW LEVEL SECURITY",
  "REVOKE ALL ON TABLE public.figma_oauth_states FROM PUBLIC, anon, authenticated",
  "code_verifier_enc bytea",
  "client_nonce text",
  "claimed_at timestamptz",
  "claim_expires_at timestamptz",
  "CHECK (client_nonce ~ '^[a-f0-9]{48}$')",
  "provider = 'figma'",
  "authorization_scopes <@ ARRAY['file_content:read']::text[]",
  "extensions.pgp_sym_encrypt(v_verifier, v_passphrase)",
  "CREATE OR REPLACE FUNCTION public.reserve_figma_oauth_authorization_v1(",
  "CREATE OR REPLACE FUNCTION public.claim_figma_oauth_state_v1(\n  p_state text,\n  p_client_nonce text",
  "CREATE OR REPLACE FUNCTION public.cleanup_figma_oauth_states_v1(",
  "CREATE OR REPLACE FUNCTION public.commit_figma_oauth_authorization_v1(",
  "CREATE OR REPLACE FUNCTION public.claim_figma_oauth_refresh_v1(",
  "CREATE OR REPLACE FUNCTION public.commit_figma_oauth_refresh_v1(",
  "CREATE OR REPLACE FUNCTION public.release_figma_oauth_refresh_v1(",
  "CREATE OR REPLACE FUNCTION public.invalidate_figma_oauth_credential_v1(",
  "CREATE OR REPLACE FUNCTION public.disconnect_figma_oauth_provider_v1(",
  "CREATE OR REPLACE FUNCTION public.get_figma_oauth_status_v1(p_user_id uuid)",
  "auth.role() IS DISTINCT FROM 'service_role'",
  "SET search_path = pg_catalog, public, extensions",
  "figma_oauth_authorization_stale",
  "figma_oauth_refresh_stale",
  "figma_oauth_scope_narrowed",
  "figma_oauth_account_mismatch",
  "refresh_claim_expires_at <= clock_timestamp()",
  "last_operation_kind = 'disconnect'",
  "reserved_oauth_credential",
  "lower(provider) IN ('google', 'microsoft', 'figma')",
]) {
  check(migration.includes(marker), `migration pins ${marker}`);
}

const claimStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.claim_figma_oauth_state_v1(\n  p_state text,\n  p_client_nonce text",
);
const claimEnd = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.commit_figma_oauth_authorization_v1(",
);
const claimBody = migration.slice(claimStart, claimEnd);
check(claimStart >= 0 && claimEnd > claimStart, "single-use state claim has a bounded body");
check(
  claimBody.indexOf("SET claimed_at = clock_timestamp()")
    < claimBody.indexOf("extensions.pgp_sym_decrypt(v_state_row.code_verifier_enc"),
  "state is atomically claimed before its PKCE verifier leaves PostgreSQL",
);
check(
  claimBody.includes("IF v_state_row.claimed_at IS NOT NULL THEN RETURN")
    && claimBody.includes("AND state_row.claimed_at IS NULL")
    && claimBody.includes("claim_expires_at = clock_timestamp() + interval '1 minute'"),
  "a claimed callback remains visible behind a bounded lease but cannot cross the provider boundary twice",
);
check(
  claimBody.includes("v_client_nonce !~ '^[a-f0-9]{48}$'")
    && claimBody.includes("state_row.client_nonce = v_client_nonce")
    && claimBody.includes("v_state_row.client_nonce,"),
  "atomic callback claim validates, matches, and returns the exact client nonce",
);
check(
  claimBody.indexOf("pg_advisory_xact_lock(")
    < claimBody.indexOf("FROM public.oauth_provider_credentials AS credential")
    && claimBody.indexOf("FROM public.oauth_provider_credentials AS credential")
      < claimBody.indexOf("SELECT * INTO v_state_row\n  FROM public.figma_oauth_states AS state_row"),
  "callback claim follows advisory, credential, then state lock order",
);
check(
  claimBody.includes("v_credential.intent_epoch <> v_state_row.intent_epoch")
    && claimBody.includes("v_credential.revision <> v_state_row.credential_revision")
    && claimBody.includes("v_credential.authorization_operation_id IS DISTINCT FROM v_state_row.operation_id"),
  "callback claim is fenced by intent, revision, and operation",
);

const reserveStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.reserve_figma_oauth_authorization_v1(",
);
const reserveEnd = claimStart;
const reserveBody = migration.slice(reserveStart, reserveEnd);
check(
  reserveBody.indexOf("pg_advisory_xact_lock(") < reserveBody.indexOf("SELECT * INTO v_row"),
  "authorization lock precedes the credential control read",
);
check(
  reserveBody.indexOf("intent_epoch = credential.intent_epoch + 1")
    < reserveBody.indexOf("INSERT INTO public.figma_oauth_states("),
  "authorization advances intent before state publication",
);
check(
  reserveBody.includes("v_verifier !~ '^[A-Za-z0-9._~-]{43,128}$'"),
  "PKCE verifier shape is validated before encryption",
);
check(
  reserveBody.includes("v_state !~ '^[a-f0-9]{48}$'")
    && reserveBody.includes("v_client_nonce !~ '^[a-f0-9]{48}$'")
    && reserveBody.includes("state, client_nonce, user_id")
    && reserveBody.includes("v_state, v_client_nonce, p_user_id"),
  "reservation validates and persists both exact 192-bit state halves",
);
check(
  reserveBody.includes("AND state_row.state = v_state\n      AND state_row.client_nonce = v_client_nonce")
    && reserveBody.includes("figma_oauth_authorization_operation_reused"),
  "reservation replay is idempotent only for the same full issued state",
);
check(
  migration.includes(
    "DROP FUNCTION IF EXISTS public.reserve_figma_oauth_authorization_v1(\n  uuid, text, text, text, uuid, timestamptz",
  )
    && migration.includes("DROP FUNCTION IF EXISTS public.claim_figma_oauth_state_v1(text);")
    && migration.includes(
      "GRANT EXECUTE ON FUNCTION public.claim_figma_oauth_state_v1(text, text) TO service_role",
    ),
  "reapply removes partial-state overloads and grants only the full-state claim",
);

const refreshStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.claim_figma_oauth_refresh_v1(",
);
const refreshCommitStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.commit_figma_oauth_refresh_v1(",
);
const refreshBody = migration.slice(refreshStart, refreshCommitStart);
check(
  refreshBody.includes("greatest(15, least(coalesce(p_lease_seconds, 45), 120))"),
  "refresh lease is bounded",
);
check(
  refreshBody.includes("v_row.refresh_claim_id <> p_claim_id")
    && refreshBody.includes("v_row.refresh_claim_expires_at > clock_timestamp()"),
  "competing live refresh claims return busy",
);
const pendingAuthorizationGuard = refreshBody.indexOf(
  "IF v_row.authorization_operation_id IS NOT NULL THEN",
);
const ordinaryFreshnessGuard = refreshBody.indexOf(
  "IF v_row.expires_at > clock_timestamp() + interval '5 minutes' THEN",
);
check(
  pendingAuthorizationGuard >= 0
    && ordinaryFreshnessGuard > pendingAuthorizationGuard
    && refreshBody.slice(pendingAuthorizationGuard, ordinaryFreshnessGuard).includes("'fresh'::text")
    && refreshBody.slice(pendingAuthorizationGuard, ordinaryFreshnessGuard).includes("'busy'::text")
    && !refreshBody.slice(pendingAuthorizationGuard, ordinaryFreshnessGuard).includes("SET refresh_claim_id = p_claim_id"),
  "an open authorization can read an unexpired old token but cannot rotate the callback revision",
);
check(
  refreshBody.includes("NOT EXISTS (")
    && refreshBody.includes("OR EXISTS (")
    && refreshBody.includes("state_row.operation_id = v_row.authorization_operation_id")
    && refreshBody.includes("state_row.expires_at <= clock_timestamp()")
    && refreshBody.includes("state_row.claim_expires_at <= clock_timestamp()")
    && refreshBody.includes("SET authorization_operation_id = NULL")
    && refreshBody.indexOf("NOT EXISTS (") < refreshBody.indexOf("IF v_row.authorization_operation_id IS NOT NULL THEN"),
  "the ordinary credential claim self-heals an exact missing or expired state before suppressing an in-flight callback",
);

const authorizationCommitStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.commit_figma_oauth_authorization_v1(",
);
const authorizationCommitBody = migration.slice(authorizationCommitStart, refreshStart);
check(
  authorizationCommitBody.includes("DELETE FROM public.figma_oauth_states AS state_row")
    && authorizationCommitBody.includes("state_row.operation_id = p_operation_id")
    && authorizationCommitBody.includes("state_row.claimed_at IS NOT NULL"),
  "successful authorization commit retires its exact claimed callback state",
);

const cleanupStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.cleanup_figma_oauth_states_v1(",
);
const cleanupEnd = migration.indexOf(
  "-- Remove the unpublished pre-full-state signatures",
);
const cleanupBody = migration.slice(cleanupStart, cleanupEnd);
check(
  cleanupStart >= 0 && cleanupEnd > cleanupStart
    && cleanupBody.includes("pg_advisory_xact_lock(")
    && cleanupBody.includes("coalesce(state_row.claim_expires_at, state_row.expires_at)")
    && cleanupBody.includes("state_row.claim_expires_at <= clock_timestamp()")
    && cleanupBody.includes("credential.authorization_operation_id = v_candidate.operation_id")
    && cleanupBody.includes("credential.intent_epoch = v_candidate.intent_epoch")
    && cleanupBody.includes("credential.revision = v_candidate.credential_revision"),
  "bulk expiration cleanup retires only the exact abandoned authorization behind the canonical user lock",
);

const refreshCommitEnd = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.release_figma_oauth_refresh_v1(",
);
const refreshCommitBody = migration.slice(refreshCommitStart, refreshCommitEnd);
check(
  refreshCommitBody.includes("v_row.refresh_claim_id IS DISTINCT FROM p_claim_id")
    && refreshCommitBody.includes("v_row.refresh_claim_expires_at <= clock_timestamp()"),
  "refresh commit requires its unexpired lease",
);
check(
  refreshCommitBody.includes("v_row.intent_epoch <> p_expected_intent_epoch")
    && refreshCommitBody.includes("v_row.revision <> p_expected_revision"),
  "refresh commit uses intent and revision CAS",
);

const disconnectStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.disconnect_figma_oauth_provider_v1(",
);
const invalidationStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.invalidate_figma_oauth_credential_v1(",
);
const invalidationBody = migration.slice(invalidationStart, disconnectStart);
check(
  invalidationStart >= 0 && disconnectStart > invalidationStart,
  "provider-auth-rejection invalidation has a bounded body",
);
check(
  invalidationBody.includes("v_row.last_operation_kind = 'provider_auth_rejection'")
    && invalidationBody.includes("v_row.last_operation_id = p_operation_id")
    && invalidationBody.includes("RETURN QUERY SELECT true, v_row.revision, v_row.intent_epoch"),
  "exact provider-auth-rejection replay is idempotent",
);
check(
  invalidationBody.includes("v_row.status <> 'connected'")
    && invalidationBody.includes("v_row.intent_epoch <> p_expected_intent_epoch")
    && invalidationBody.includes("v_row.revision <> p_expected_revision")
    && invalidationBody.includes("RETURN QUERY SELECT false, v_row.revision, v_row.intent_epoch"),
  "provider rejection reports the current fence without touching a stale credential",
);
check(
  invalidationBody.includes("revision = credential.revision + 1")
    && invalidationBody.includes("intent_epoch = credential.intent_epoch + 1")
    && invalidationBody.includes("access_token_enc = NULL")
    && invalidationBody.includes("refresh_token_enc = NULL")
    && invalidationBody.includes("refresh_claim_id = NULL")
    && invalidationBody.includes("last_operation_kind = 'provider_auth_rejection'"),
  "exact provider rejection creates a secret-free tombstone and advances both fences",
);
check(
  invalidationBody.includes("DELETE FROM public.figma_oauth_states"),
  "provider rejection without a pending reconnect retires outstanding callback state",
);
const pendingRejectionStart = invalidationBody.indexOf(
  "IF v_row.authorization_operation_id IS NOT NULL THEN",
);
const ordinaryRejectionStart = invalidationBody.indexOf(
  "UPDATE public.oauth_provider_credentials AS credential\n  SET status = 'disconnected',\n      revision = credential.revision + 1",
);
const pendingRejectionBody = invalidationBody.slice(pendingRejectionStart, ordinaryRejectionStart);
check(
  pendingRejectionStart >= 0 && ordinaryRejectionStart > pendingRejectionStart,
  "pending reconnect rejection has a distinct branch before ordinary tombstoning",
);
check(
  pendingRejectionBody.includes("access_token_enc = NULL")
    && pendingRejectionBody.includes("refresh_token_enc = NULL")
    && !pendingRejectionBody.includes("authorization_operation_id = NULL")
    && !pendingRejectionBody.includes("revision = credential.revision + 1")
    && !pendingRejectionBody.includes("intent_epoch = credential.intent_epoch + 1")
    && !pendingRejectionBody.includes("DELETE FROM public.figma_oauth_states"),
  "rejection during reconnect removes old secrets while preserving the pending callback fence and state",
);
const statusStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.get_figma_oauth_status_v1(p_user_id uuid)",
);
const disconnectBody = migration.slice(disconnectStart, statusStart);
check(
  disconnectBody.includes("status = 'disconnected'")
    && disconnectBody.includes("revision = credential.revision + 1")
    && disconnectBody.includes("intent_epoch = credential.intent_epoch + 1")
    && disconnectBody.includes("access_token_enc = NULL")
    && disconnectBody.includes("refresh_token_enc = NULL"),
  "disconnect persists a secret-free tombstone and invalidates old work",
);
check(
  disconnectBody.includes("DELETE FROM public.figma_oauth_states"),
  "disconnect removes outstanding callback states",
);

check(
  migration.includes("v_meta := v_row.endpoint::jsonb")
    && migration.includes("v_subject IS NOT NULL")
    && migration.includes("cardinality(v_scopes) > 0")
    && migration.includes("v_expires_at > clock_timestamp()"),
  "legacy migration accepts only parseable, unexpired, subject-bound, scoped credentials",
);
check(
  !migration.includes("SET search_path = public")
    && !migration.includes("SET search_path = extensions, public"),
  "every explicit function search path starts with pg_catalog",
);
check(
  !/GRANT EXECUTE ON FUNCTION public\.(?:reserve|claim|commit|release|invalidate|disconnect|get|cleanup)_figma_oauth[^\n]* TO authenticated/u.test(
    migration,
  ),
  "authenticated never receives a Figma OAuth control RPC",
);
check(
  migration.includes(
    "REVOKE ALL ON FUNCTION public.invalidate_figma_oauth_credential_v1(uuid, bigint, bigint, uuid)\n  FROM PUBLIC, anon, authenticated",
  )
    && migration.includes(
      "GRANT EXECUTE ON FUNCTION public.invalidate_figma_oauth_credential_v1(uuid, bigint, bigint, uuid) TO service_role",
    ),
  "provider rejection invalidation is executable only by service role",
);
check(
  !migration.includes("refresh_token', v_refresh_token")
    && !migration.includes("endpoint = v_meta::text"),
  "the control plane never writes a plaintext refresh token to generic endpoint metadata",
);

const sectionStartMarker = "-- SECTION 43: Figma OAuth credential and callback control plane";
const sectionEndMarker = "-- END SECTION 43: Figma OAuth credential and callback control plane";
const sectionStart = consolidated.indexOf(sectionStartMarker);
const sectionEnd = consolidated.indexOf(sectionEndMarker, sectionStart + sectionStartMarker.length);
check(sectionStart >= 0 && sectionEnd > sectionStart, "consolidated SQL contains a bounded section 43");
const sectionBody = consolidated
  .slice(sectionStart + sectionStartMarker.length, sectionEnd)
  .split("\n")
  .filter((line) => !line.startsWith("-- Source:")
    && !line.startsWith("-- Apply only after")
    && !line.startsWith("-- this transaction succeeds.")
    && line !== "-- =============================================================================")
  .join("\n")
  .trim();
check(sectionBody === migration.trim(), "consolidated section 43 is byte-identical to the migration body");

console.log(`Figma OAuth credential control SQL smoke passed (${assertions} assertions).`);
