/** Static, parity, ownership, and runtime contract for primary-agent identity RPC §47. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20260817130000_agent_identity_primary_rpc.sql'),
  'utf8',
);
const consolidated = readFileSync(resolve(root, 'docs/RUN_THIS_SQL.sql'), 'utf8');
const roadmap = readFileSync(resolve(root, 'docs/AGENTS_ROADMAP.md'), 'utf8');
const stackReference = readFileSync(resolve(root, 'docs/UC_APP_STACK_REFERENCE.md'), 'utf8');
const claude = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
const identityRuntime = readFileSync(resolve(root, 'src/lib/agentIdentity.ts'), 'utf8');
const behaviorSmoke = readFileSync(
  resolve(root, 'scripts/agent-identity-primary-rpc-sql-behavior-smoketest.sh'),
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

const header = '-- BEGIN SECTION 47: Transactional primary-agent identity selection';
const sourceMarker = '-- Source: supabase/migrations/20260817130000_agent_identity_primary_rpc.sql';
const footer = '-- END SECTION 47: Transactional primary-agent identity selection';
const prefix = `${header}\n${sourceMarker}\n`;
const sectionStart = consolidated.indexOf(prefix);
const sectionEnd = consolidated.indexOf(footer, sectionStart + prefix.length);
check(sectionStart >= 0 && sectionEnd > sectionStart, '§47 has exact BEGIN, Source, and END boundaries');
assertions += 1;
assert.equal(
  consolidated.slice(sectionStart + prefix.length, sectionEnd),
  migration,
  '§47 executable body is byte-exact with the canonical migration',
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
  /^\s*-- BEGIN SECTION 48: Atomic published-agent Spirit projection/u.test(
    consolidated.slice(sectionEnd + footer.length),
  ),
  '§47 closes before the immediately following §48 section',
);
check(
  consolidated.includes('--   §47 Transactional primary-agent identity selection'),
  'consolidated contents index records §47',
);

for (const marker of [
  'BEGIN;',
  "IF to_regclass('public.agent_identities') IS NULL THEN",
  'ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY',
  'PARTITION BY identity_row.user_id, identity_row.bound_ai_provider',
  'AND ranked.primary_rank > 1',
  'CREATE UNIQUE INDEX IF NOT EXISTS agent_identities_one_primary_per_provider_idx',
  'ON public.agent_identities (user_id, bound_ai_provider)',
  'WHERE is_primary IS TRUE\n    AND bound_ai_provider IS NOT NULL',
  'CREATE OR REPLACE FUNCTION public.set_main_agent_for_provider_v1(',
  'RETURNS jsonb',
  'SECURITY DEFINER',
  "SET search_path = ''",
  'v_actor_id uuid := auth.uid()',
  "RAISE EXCEPTION 'authentication_required'",
  'pg_catalog.char_length(p_session_key) NOT BETWEEN 1 AND 200',
  'pg_catalog.char_length(p_provider_type) NOT BETWEEN 1 AND 200',
  'pg_catalog.pg_advisory_xact_lock(',
  'pg_catalog.hashtextextended(v_actor_id::text, 714071347::bigint)',
  'ON CONFLICT (user_id, session_key) DO NOTHING',
  'INTO STRICT v_target_id',
  'FOR UPDATE;',
  'AND identity_row.session_key <> p_session_key',
  'AND identity_row.is_primary IS TRUE;',
  'SET bound_ai_provider = p_provider_type,\n      is_primary = true,',
  'GET DIAGNOSTICS v_target_rows = ROW_COUNT',
  'IF v_target_rows <> 1 THEN',
  'IF v_provider_row_count NOT BETWEEN 1 AND 5000 THEN',
  'IF v_primary_count <> 1 OR v_target_primary_count <> 1 THEN',
  'pg_catalog.jsonb_agg(',
  'pg_catalog.pg_column_size(v_rows) > 4194304',
  "'schemaVersion', 1",
  "'userId', v_actor_id::text",
  "'providerType', p_provider_type",
  "'requestedSessionKey', p_session_key",
  "'primarySessionKey', p_session_key",
  "'targetRowCount', v_target_rows",
  "'rows', v_rows",
  'REVOKE ALL ON FUNCTION public.set_main_agent_for_provider_v1(text, text)',
  'FROM PUBLIC, anon, authenticated, service_role',
  'GRANT EXECUTE ON FUNCTION public.set_main_agent_for_provider_v1(text, text)\n  TO authenticated',
  'CREATE OR REPLACE FUNCTION public.guard_agent_identity_primary_columns_v1()',
  "SET search_path = ''",
  "v_sensitive_change := NEW.is_primary IS TRUE",
  '(NEW.is_primary IS TRUE) IS DISTINCT FROM (OLD.is_primary IS TRUE)',
  'AND (NEW.is_primary IS TRUE OR OLD.is_primary IS TRUE)',
  "ELSIF TG_OP = 'DELETE' THEN",
  'v_sensitive_change := OLD.is_primary IS TRUE',
  'CREATE TRIGGER agent_identity_primary_columns_guard',
  'CREATE TRIGGER agent_identity_primary_delete_guard',
  'BEFORE DELETE',
  "RAISE EXCEPTION 'agent_identity_primary_rpc_required'",
  'COMMIT;',
  "NOTIFY pgrst, 'reload schema';",
]) {
  check(migration.includes(marker), `migration pins ${marker}`);
}
check(
  !/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON\s+(?:TABLE\s+)?public\.agent_identities/iu.test(migration),
  'migration never widens direct agent_identities table privileges',
);

const functionBody = section(
  migration,
  'CREATE OR REPLACE FUNCTION public.set_main_agent_for_provider_v1(',
  'REVOKE ALL ON FUNCTION public.set_main_agent_for_provider_v1(text, text)',
);
check(
  !functionBody.includes('SET search_path = pg_catalog, public')
    && !functionBody.includes('FROM agent_identities')
    && !functionBody.includes('UPDATE agent_identities')
    && !functionBody.includes('INSERT INTO agent_identities'),
  'SECURITY DEFINER body has an empty path and no unqualified identity relation',
);
const lockAt = functionBody.indexOf('pg_catalog.pg_advisory_xact_lock(');
const insertAt = functionBody.indexOf('INSERT INTO public.agent_identities');
const targetLockAt = functionBody.indexOf('INTO STRICT v_target_id');
const clearAt = functionBody.indexOf('SET is_primary = false', targetLockAt);
const promoteAt = functionBody.indexOf('SET bound_ai_provider = p_provider_type', clearAt);
const invariantAt = functionBody.indexOf('IF v_primary_count <> 1', promoteAt);
const rowsAt = functionBody.indexOf('pg_catalog.jsonb_agg(', invariantAt);
const receiptAt = functionBody.indexOf('RETURN pg_catalog.jsonb_build_object(', rowsAt);
check(
  lockAt >= 0
    && insertAt > lockAt
    && targetLockAt > insertAt
    && clearAt > targetLockAt
    && promoteAt > clearAt
    && invariantAt > promoteAt
    && rowsAt > invariantAt
    && receiptAt > rowsAt,
  'owner lock, target materialization, peer clear, target promote, invariant, rows, and receipt stay ordered',
);
assertions += 1;
assert.equal(
  (functionBody.match(/FROM public\.agent_identities/gu) || []).length
    + (functionBody.match(/UPDATE public\.agent_identities/gu) || []).length
    + (functionBody.match(/INSERT INTO public\.agent_identities/gu) || []).length,
  6,
  'every identity relation touch in the definer body is explicit and review-bounded',
);

const exactPrimary = section(
  identityRuntime,
  'export async function setMainAgentForProviderExact',
  '// ─── Customize Agent Appearance',
);
for (const marker of [
  "beginAgentIdentityExactCommand('primary', authority, normalizedProviderType)",
  'verifyAgentIdentityExactAuthority(authority, commandFence)',
  ".rpc('set_main_agent_for_provider_v1'",
  'p_session_key: normalizedSessionKey',
  'p_provider_type: normalizedProviderType',
  ".setHeader('Authorization', `Bearer ${verifiedAuthority.accessToken}`)",
  'parseAgentIdentityPrimaryRpcReceipt(',
  "error: 'mutation_superseded'",
  'publishCurrentAgentIdentityServerTruthExact(',
]) {
  check(exactPrimary.includes(marker), `exact runtime pins ${marker}`);
}
check(
  (exactPrimary.match(/isAgentIdentityExactAuthorityCurrent\(/gu) || []).length >= 6,
  'generation fence surrounds verification, RPC, receipt, and publication handoff',
);
check(
  !exactPrimary.includes(".from('agent_identities')")
    && !exactPrimary.includes('saveAgentIdentityMapExact(')
    && !exactPrimary.includes('loadAgentIdentityMutationBaseExact(')
    && !exactPrimary.includes('.update(')
    && !exactPrimary.includes('.upsert('),
  'primary-agent exact runtime has no residual client multi-row writer',
);
check(
  exactPrimary.indexOf('parseAgentIdentityPrimaryRpcReceipt(')
    < exactPrimary.indexOf('publishCurrentAgentIdentityServerTruthExact('),
  'validated server receipt precedes the cross-realm server-truth publication',
);

const parser = section(
  identityRuntime,
  'function parseAgentIdentityPrimaryRpcReceipt(',
  'function agentIdentityExactServerWriteMode(',
);
for (const marker of [
  "receipt.schemaVersion !== 1",
  'receipt.userId !== authority.userId',
  'receipt.providerType !== providerType',
  'receipt.requestedSessionKey !== sessionKey',
  'receipt.primarySessionKey !== sessionKey',
  'receipt.targetRowCount !== 1',
  'receipt.rows.length !== receipt.rowCount',
  'row.user_id !== authority.userId',
  'row.bound_ai_provider !== providerType',
  'primaryCount !== 1',
  'primaryRow.session_key !== sessionKey',
  'primaryRow.id !== receipt.primaryId',
  'primaryRow.updated_at !== receipt.primaryUpdatedAt',
]) {
  check(parser.includes(marker), `receipt validator pins ${marker}`);
}

for (const marker of [
  'psql_smoke -f "$migration" >/dev/null\n# SQL Editor/consolidated replay must remain safe.\npsql_smoke -f "$migration"',
  'partial unique primary-agent index is not valid',
  'primary-agent RPC grants are not authenticated-only',
  'legacy duplicate repair retained the wrong primary',
  '$zero_existing$',
  '$one_existing$',
  '$multiple_existing$',
  '$rollback_after_clear$',
  '$ordinary_identity_update_preserves_primary$',
  'non-primary provider metadata mutation was blocked',
  'direct primary-row delete was accepted',
  'ordinary non-primary identity delete was blocked',
  'stale full-row compatibility upsert was accepted',
  '$non_owner_isolation$',
  '$concurrent_final_truth$',
]) {
  check(behaviorSmoke.includes(marker), `behavior smoke proves ${marker}`);
}

const expectedScripts: Record<string, string> = {
  'smoke:agent-identity-primary-rpc-sql':
    'npx tsx scripts/agent-identity-primary-rpc-sql-smoketest.ts',
  'smoke:agent-identity-primary-rpc-sql-behavior':
    'sh scripts/agent-identity-primary-rpc-sql-behavior-smoketest.sh',
};
for (const [name, command] of Object.entries(expectedScripts)) {
  assertions += 1;
  assert.equal(packageJson.scripts?.[name], command, `package exposes ${name}`);
}
const aggregate = packageJson.scripts?.['check:office-addons'] || '';
check(
  aggregate.includes('npm run smoke:agent-identity-primary-rpc-sql'),
  'default Office gate includes the static/parity §47 smoke',
);
check(
  !aggregate.includes('npm run smoke:agent-identity-primary-rpc-sql-behavior'),
  'default Office gate does not require a developer-local PostgreSQL owner',
);

for (const [document, name] of [
  [roadmap, 'roadmap'],
  [stackReference, 'stack reference'],
  [claude, 'CLAUDE'],
] as const) {
  check(
    document.includes('20260817130000_agent_identity_primary_rpc.sql'),
    `${name} names the canonical §47 migration`,
  );
  check(document.includes('§47'), `${name} records consolidated section §47`);
}
check(
  roadmap.includes('| 47 | Transactional primary-agent identity selection'),
  'roadmap SQL checklist records §47',
);
const roadmapSection47 = roadmap
  .split(/\r?\n/u)
  .find(line => line.startsWith('| 47 | Transactional primary-agent identity selection'));
check(
  roadmapSection47?.includes('**Pending / not applied.**'),
  'roadmap separates source proof from live deployment proof',
);

console.log(`Agent identity primary RPC SQL smoke passed (${assertions} assertions).`);
