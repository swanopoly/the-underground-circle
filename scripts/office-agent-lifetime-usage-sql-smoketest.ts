/** Static, parity, ownership, runtime, and UI contract for Office lifetime usage §51. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20260821150000_office_agent_lifetime_usage.sql'),
  'utf8',
);
const consolidated = readFileSync(resolve(root, 'docs/RUN_THIS_SQL.sql'), 'utf8');
const roadmap = readFileSync(resolve(root, 'docs/AGENTS_ROADMAP.md'), 'utf8');
const stackReference = readFileSync(resolve(root, 'docs/UC_APP_STACK_REFERENCE.md'), 'utf8');
const claude = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
const terminalRuntime = readFileSync(resolve(root, 'src/lib/officeTerminal.ts'), 'utf8');
const officeAgents = readFileSync(resolve(root, 'src/lib/officeAgents.ts'), 'utf8');
const officeTab = readFileSync(resolve(root, 'src/screens/circles/tabs/OfficeTab.tsx'), 'utf8');
const activityPanel = readFileSync(
  resolve(root, 'src/screens/circles/tabs/office/AgentActivityPanel.tsx'),
  'utf8',
);
const analyticsPanel = readFileSync(resolve(root, 'src/components/OfficeAnalyticsPanel.tsx'), 'utf8');
const profileScreen = readFileSync(resolve(root, 'src/screens/profile/ProfileScreen.tsx'), 'utf8');
const behaviorSmoke = readFileSync(
  resolve(root, 'scripts/office-agent-lifetime-usage-sql-behavior-smoketest.sh'),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function section(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  check(startAt >= 0, `source marker exists: ${start}`);
  check(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const header = '-- BEGIN SECTION 51: Owner-private Office agent lifetime usage';
const sourceMarker = '-- Source: supabase/migrations/20260821150000_office_agent_lifetime_usage.sql';
const footer = '-- END SECTION 51: Owner-private Office agent lifetime usage';
const prefix = `${header}\n${sourceMarker}\n`;
const sectionStart = consolidated.indexOf(prefix);
const sectionEnd = consolidated.indexOf(footer, sectionStart + prefix.length);
check(sectionStart >= 0 && sectionEnd > sectionStart, '§51 has exact BEGIN, Source, and END boundaries');
assertions += 1;
assert.equal(
  consolidated.slice(sectionStart + prefix.length, sectionEnd),
  migration,
  '§51 executable body is byte-exact with the canonical migration',
);
for (const marker of [header, sourceMarker, footer]) {
  assertions += 1;
  assert.equal(
    consolidated.indexOf(marker, consolidated.indexOf(marker) + marker.length),
    -1,
    `${marker} appears exactly once`,
  );
}
check(
  consolidated.includes('--   §51 Owner-private Office agent lifetime usage'),
  'consolidated contents index records §51',
);

for (const marker of [
  'BEGIN;',
  'CREATE TABLE IF NOT EXISTS public.office_agent_usage_profiles',
  'session_key text COLLATE "C" NOT NULL',
  'PRIMARY KEY (owner_id, session_key)',
  'CONSTRAINT office_agent_usage_profile_counters_nonnegative',
  'CONSTRAINT office_agent_usage_profile_counters_bounded',
  'ALTER TABLE public.office_agent_usage_profiles ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.office_agent_usage_profiles FORCE ROW LEVEL SECURITY',
  'FROM pg_catalog.pg_policies',
  "tablename = 'office_agent_usage_profiles'",
  'CREATE POLICY office_agent_usage_profiles_select_own_v1',
  'USING (owner_id = auth.uid())',
  'REVOKE ALL ON TABLE public.office_agent_usage_profiles',
  'GRANT SELECT ON TABLE public.office_agent_usage_profiles TO authenticated',
  'GRANT ALL ON TABLE public.office_agent_usage_profiles TO service_role',
  'DO $legacy_snapshot_preflight$',
  "RAISE EXCEPTION 'office_agent_lifetime_legacy_snapshot_invalid'",
  'DO $usage_profile_capacity_preflight$',
  'HAVING pg_catalog.count(*) > 5000',
  'SELECT DISTINCT ON (snapshot.owner_id, snapshot.snapshot_key COLLATE "C")',
  'ON CONFLICT (owner_id, session_key) DO NOTHING',
  'DO $legacy_identity_preflight$',
  "RAISE EXCEPTION 'office_agent_lifetime_legacy_identity_invalid'",
  'baseline_observed',
  'last_observed_at timestamptz NOT NULL',
  'false,',
  'CREATE OR REPLACE FUNCTION public.sync_agent_profile_usage_v1(',
  'RETURNS jsonb',
  'SECURITY DEFINER',
  "SET search_path = ''",
  'v_actor_id uuid := auth.uid()',
  "RAISE EXCEPTION 'authentication_required'",
  "RAISE EXCEPTION 'office_agent_usage_circle_membership_required'",
  "RAISE EXCEPTION 'office_agent_usage_identity_invalid'",
  "RAISE EXCEPTION 'office_agent_usage_counters_invalid'",
  'p_observed_at timestamptz',
  'pg_catalog.pg_advisory_xact_lock(',
  'pg_catalog.hashtextextended(v_actor_id::text, 151817951::bigint)',
  'FOR UPDATE;',
  'WHEN p_input_tokens >= v_existing.last_input_tokens',
  'ELSE p_input_tokens',
  "v_observation_disposition := 'stale'",
  'p_observed_at < v_existing.last_observed_at',
  'last_observed_at = p_observed_at',
  'session_count = profile.session_count + CASE WHEN v_reset THEN 1 ELSE 0 END',
  'v_owner_profile_count >= 5000',
  "RAISE EXCEPTION 'office_agent_usage_profile_limit_exceeded'",
  'INSERT INTO public.office_agent_usage_profiles',
  'v_office_agent_row_count > 1',
  "IF v_office_agent_row_count = 1 AND v_observation_disposition <> 'stale' THEN",
  'UPDATE public.circle_office_agents AS office_agent',
  "'schemaVersion', 1",
  "'userId', v_actor_id::text",
  "'sessionKey', p_session_key",
  "'observationDisposition', v_observation_disposition",
  "'officeAgentRowCount', v_office_agent_row_count",
  "'publicProjectionDisposition', v_public_projection_disposition",
  "'publicProjectionApplied'",
  "'profile', pg_catalog.to_jsonb(v_profile)",
  'REVOKE ALL ON FUNCTION public.sync_agent_profile_usage_v1(',
  'FROM PUBLIC, anon, authenticated, service_role',
  'GRANT EXECUTE ON FUNCTION public.sync_agent_profile_usage_v1(',
  'TO authenticated',
  'COMMIT;',
  "NOTIFY pgrst, 'reload schema';",
]) {
  check(migration.includes(marker), `migration pins ${marker}`);
}
check(
  !/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON\s+(?:TABLE\s+)?public\.office_agent_usage_profiles\s+TO\s+authenticated/iu.test(migration),
  'authenticated clients never receive a direct lifetime-ledger write grant',
);

const rpc = section(
  migration,
  'CREATE OR REPLACE FUNCTION public.sync_agent_profile_usage_v1(',
  'REVOKE ALL ON FUNCTION public.sync_agent_profile_usage_v1(',
);
check(
  !rpc.includes('FROM circle_members')
    && !rpc.includes('FROM circle_office_agents')
    && !rpc.includes('UPDATE circle_office_agents')
    && !rpc.includes('FROM office_agent_usage_profiles')
    && !rpc.includes('UPDATE office_agent_usage_profiles')
    && !rpc.includes('INSERT INTO office_agent_usage_profiles'),
  'SECURITY DEFINER body uses only schema-qualified relations',
);
const membershipAt = rpc.indexOf('FROM public.circle_members');
const lockAt = rpc.indexOf('pg_catalog.pg_advisory_xact_lock(');
const profileLockAt = rpc.indexOf('FOR UPDATE;', lockAt);
const mutationAt = Math.min(
  ...[
    rpc.indexOf('UPDATE public.office_agent_usage_profiles', profileLockAt),
    rpc.indexOf('INSERT INTO public.office_agent_usage_profiles', profileLockAt),
  ].filter(index => index >= 0),
);
const projectionAt = rpc.indexOf('UPDATE public.circle_office_agents', mutationAt);
const receiptAt = rpc.indexOf('RETURN pg_catalog.jsonb_build_object(', projectionAt);
check(
  membershipAt >= 0
    && lockAt > membershipAt
    && profileLockAt > lockAt
    && mutationAt > profileLockAt
    && projectionAt > mutationAt
    && receiptAt > projectionAt,
  'membership, owner lock, profile lock, ledger mutation, optional projection, and receipt stay ordered',
);

const loader = section(
  terminalRuntime,
  'export async function loadOfficeAgentUsageProfilesExact(',
  'export function validateTokenSnapshotUsage(',
);
for (const marker of [
  'createTerminalAuthorityOperationFence(capturedAuthority, isCurrent)',
  'safeGetUserForAccessToken(operation.authority.accessToken)',
  'getSupabaseClientForAccessToken(operation.authority.accessToken)',
  ".from('office_agent_usage_profiles')",
  ".select('*', { count: 'exact' })",
  '.eq(\'owner_id\', operation.authority.userId)',
  '.limit(OFFICE_AGENT_USAGE_PROFILE_LIMIT + 1)',
  '.abortSignal(operation.signal)',
  'data.length !== count',
  'profiles.has(profile.sessionKey)',
  'operation.stop()',
]) {
  check(loader.includes(marker), `exact lifetime loader pins ${marker}`);
}
check(!/\bsupabase\s*\./u.test(loader), 'exact lifetime loader never uses the shared Supabase singleton');

const syncRuntime = section(
  terminalRuntime,
  'export async function syncAgentTokenSnapshot(',
  '// ─── Update agent position',
);
for (const marker of [
  'normalizeTerminalExactAuthority(input.authority)',
  'createTerminalAuthorityOperationFence(authority, input.isCurrent)',
  'safeGetUserForAccessToken(authority.accessToken)',
  'getSupabaseClientForAccessToken(authority.accessToken)',
  ".rpc('sync_agent_profile_usage_v1'",
  'p_session_key: normalizedSnapshotKey',
  'p_observed_at: input.observedAt',
  'parseOfficeAgentUsageSyncReceipt(data, authority, normalizedSnapshotKey)',
  'if (!operation.isCurrent())',
  'syncLegacyPublishedAgentSnapshot(',
  'operation.stop()',
]) {
  check(syncRuntime.includes(marker), `exact lifetime sync pins ${marker}`);
}
check(!/\bsupabase\s*\./u.test(syncRuntime), 'exact lifetime sync never uses the shared Supabase singleton');

for (const marker of [
  'tokensTotal?: number',
  'export function applyOfficeAgentLifetimeUsage(',
  'export function summarizeOfficeAgentLifetimeUsage(',
  'usage.sessionKey !== agent.sessionKey',
  'finiteNonNegativeTokenCount(usage.lifetimeTokens)',
  'finiteNonNegativeCost(usage.lifetimeCost)',
]) {
  check(officeAgents.includes(marker), `agent projection pins ${marker}`);
}
for (const marker of [
  'loadOfficeAgentUsageProfilesExact(',
  'applyOfficeAgentLifetimeUsage(agent, agentUsageProfiles.get(agent.sessionKey))',
  'syncAgentTokenSnapshot({',
  'providerType: agent.providerType',
  'snapshotKey: agent.sessionKey || agent.id',
  'setAgentUsageProfiles((current)',
]) {
  check(officeTab.includes(marker), `Office wiring pins ${marker}`);
}
check(
  activityPanel.includes("label: 'LIFETIME TOKENS'")
    && activityPanel.includes("label: 'SESSION TOKENS'")
    && activityPanel.includes("label: 'LIFETIME COST'"),
  'agent detail labels lifetime and session meters separately',
);
check(
  analyticsPanel.includes('loadOfficeAgentUsageProfilesExact(')
    && analyticsPanel.includes('summarizeOfficeAgentLifetimeUsage(')
    && analyticsPanel.includes("scope === 'mine'")
    && analyticsPanel.includes("totalTokensAllTime === null ? '—'"),
  'Analytics My Agents uses exact lifetime truth and fails closed without it',
);
check(
  profileScreen.includes('AGENT TOKENS · LIFETIME')
    && profileScreen.includes('AGENT SPEND · LIFETIME')
    && profileScreen.includes('loadOfficeAgentUsageProfilesExact(')
    && profileScreen.includes('summarizeOfficeAgentLifetimeUsage('),
  'Profile renders the owner-private lifetime ledger',
);

for (const marker of [
  'psql_smoke -f "$migration" >/dev/null\n# SQL Editor/consolidated replay must remain safe',
  'legacy snapshot baseline mismatch',
  'exact replay was not idempotent',
  'session reset was not accumulated exactly',
  'delayed lower observation was counted as a reset',
  'published projection did not receive exact deltas',
  'unpublished agent did not persist privately',
  'ambiguous public projection did not preserve private lifetime truth',
  'identity-only first observation double-counted history',
  'authenticated direct lifetime mutation unexpectedly succeeded',
  'nonmember lifetime sync unexpectedly succeeded',
  'owner-private lifetime rows leaked across users',
]) {
  check(behaviorSmoke.includes(marker), `behavior smoke proves ${marker}`);
}

for (const [source, label] of [
  [roadmap, 'roadmap'],
  [stackReference, 'stack reference'],
  [claude, 'CLAUDE context'],
] as const) {
  check(source.includes('office_agent_usage_profiles'), `${label} names the canonical lifetime ledger`);
  check(source.includes('§51'), `${label} records the §51 deployment boundary`);
  check(source.toLowerCase().includes('pending'), `${label} does not overclaim live §51 deployment`);
}

const expectedScripts: Record<string, string> = {
  'smoke:office-agent-lifetime-usage-sql':
    'npx tsx scripts/office-agent-lifetime-usage-sql-smoketest.ts',
  'smoke:office-agent-lifetime-usage-sql-behavior':
    'sh scripts/office-agent-lifetime-usage-sql-behavior-smoketest.sh',
};
for (const [name, command] of Object.entries(expectedScripts)) {
  assertions += 1;
  assert.equal(packageJson.scripts?.[name], command, `${name} is wired exactly`);
}
const officeAggregate = packageJson.scripts?.['check:office-addons'] || '';
check(
  officeAggregate.includes('npm run smoke:office-agent-lifetime-usage-sql'),
  'Office aggregate runs the static lifetime usage contract',
);
check(
  officeAggregate.includes('npm run smoke:office-token-snapshot-guard')
    && officeAggregate.includes('npm run smoke:office-cost-stability'),
  'Office aggregate runs the executable client guard and lifetime/session projection checks',
);

console.log(`office agent lifetime usage SQL smoke passed (${assertions} assertions)`);
