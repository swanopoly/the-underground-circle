/**
 * Source contract for the Office Google/Microsoft OAuth credential control SQL.
 * Runtime behavior is separately exercised against disposable PostgreSQL.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260813190000_atomic_oauth_credential_store.sql"),
  "utf8",
);
const consolidated = fs.readFileSync(path.join(root, "docs", "RUN_THIS_SQL.sql"), "utf8");

let assertions = 0;
function check(value: unknown, message: string): void {
  assertions += 1;
  if (!value) throw new Error(`OAuth credential control SQL smoke failed: ${message}`);
}

for (const marker of [
  "CREATE TABLE IF NOT EXISTS public.oauth_provider_credentials (",
  "revision bigint NOT NULL DEFAULT 0",
  "intent_epoch bigint NOT NULL DEFAULT 0",
  "authorization_operation_id uuid",
  "refresh_claim_id uuid",
  "refresh_claim_expires_at timestamptz",
  "provider_subject text",
  "ALTER TABLE public.oauth_provider_credentials FORCE ROW LEVEL SECURITY",
  "CREATE OR REPLACE FUNCTION public.reserve_office_oauth_authorization_v1(",
  "CREATE OR REPLACE FUNCTION public.commit_office_oauth_authorization_v1(",
  "CREATE OR REPLACE FUNCTION public.claim_office_oauth_refresh_v1(",
  "CREATE OR REPLACE FUNCTION public.commit_office_oauth_refresh_v1(",
  "CREATE OR REPLACE FUNCTION public.release_office_oauth_refresh_v1(",
  "CREATE OR REPLACE FUNCTION public.disconnect_office_oauth_provider_v1(",
  "auth.role() IS DISTINCT FROM 'service_role'",
  "SET search_path = pg_catalog, public, extensions",
  "oauth_authorization_stale",
  "oauth_refresh_stale",
  "oauth_scope_narrowed",
  "oauth_account_mismatch",
  "reserved_oauth_credential",
  "user_api_keys_select_own_non_oauth",
  "extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase)",
  "DELETE FROM public.user_api_keys AS key_row",
]) {
  check(migration.includes(marker), `migration pins ${marker}`);
}

check(
  migration.indexOf("pg_advisory_xact_lock(") < migration.indexOf("SELECT * INTO v_row"),
  "provider lock precedes the first credential control read",
);
check(
  migration.indexOf("intent_epoch = credential.intent_epoch + 1")
    < migration.indexOf("CREATE OR REPLACE FUNCTION public.commit_office_oauth_authorization_v1("),
  "authorization reservation advances the intent before a callback can commit",
);
check(
  migration.includes("v_row.refresh_claim_expires_at <= clock_timestamp()"),
  "expired refresh claims cannot commit",
);
check(
  migration.includes("status = 'disconnected'")
    && migration.includes("access_token_enc = NULL")
    && migration.includes("refresh_token_enc = NULL")
    && migration.includes("intent_epoch = credential.intent_epoch + 1"),
  "disconnect keeps a tombstone while deleting encrypted secrets and invalidating old work",
);
check(
  migration.includes("v_row.provider_subject = trim(p_provider_subject)"),
  "an omitted callback refresh token may be preserved only for the same provider subject",
);
check(
  !migration.includes("endpoint = v_endpoint::text"),
  "the control plane never writes a plaintext refresh token to generic endpoint metadata",
);

const start = consolidated.indexOf("-- BEGIN SECTION 42: Office OAuth credential control plane");
const end = consolidated.indexOf("-- END SECTION 42: Office OAuth credential control plane");
check(start >= 0 && end > start, "consolidated SQL contains a bounded section 42");
if (start >= 0 && end > start) {
  const bodyStart = consolidated.indexOf("\n", start) + 1;
  const sectionBody = consolidated.slice(bodyStart, end).trim();
  check(sectionBody === migration.trim(), "consolidated section 42 is byte-identical to the migration body");
}

console.log(`OAuth credential control SQL smoke passed (${assertions} assertions).`);
