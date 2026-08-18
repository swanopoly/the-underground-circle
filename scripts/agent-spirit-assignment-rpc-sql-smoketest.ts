/** Static, parity, ownership, runtime, and UI contract for Spirit RPC §48. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/20260817140000_agent_spirit_assignment_rpc.sql');
const consolidated = read('docs/RUN_THIS_SQL.sql');
const roadmap = read('docs/AGENTS_ROADMAP.md');
const stackReference = read('docs/UC_APP_STACK_REFERENCE.md');
const claude = read('CLAUDE.md');
const identityRuntime = read('src/lib/agentIdentity.ts');
const spiritPanel = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');
const behaviorSmoke = read('scripts/agent-spirit-assignment-rpc-sql-behavior-smoketest.sh');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function sourceSection(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  check(startAt >= 0, `source marker exists: ${start}`);
  check(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const header = '-- BEGIN SECTION 48: Atomic published-agent Spirit projection';
const sourceMarker = '-- Source: supabase/migrations/20260817140000_agent_spirit_assignment_rpc.sql';
const footer = '-- END SECTION 48: Atomic published-agent Spirit projection';
const prefix = `${header}\n${sourceMarker}\n`;
const sectionStart = consolidated.indexOf(prefix);
const sectionEnd = consolidated.indexOf(footer, sectionStart + prefix.length);
check(sectionStart >= 0 && sectionEnd > sectionStart, '§48 has exact BEGIN, Source, and END boundaries');
assertions += 1;
assert.equal(
  consolidated.slice(sectionStart + prefix.length, sectionEnd),
  migration,
  '§48 executable body is byte-exact with the canonical migration',
);
for (const marker of [header, sourceMarker, footer]) {
  assertions += 1;
  assert.equal(
    consolidated.indexOf(marker, consolidated.indexOf(marker) + marker.length),
    -1,
    `${marker} appears exactly once`,
  );
}
check(/^\s*$/u.test(consolidated.slice(sectionEnd + footer.length)), '§48 is the closed final section');
check(consolidated.includes('--   §48 Atomic published-agent Spirit projection'), 'contents index records §48');

for (const marker of [
  'BEGIN;',
  "IF to_regclass('public.circle_office_agents') IS NULL",
  "OR to_regclass('public.agent_identities') IS NULL",
  "OR to_regclass('public.circle_members') IS NULL",
  "OR to_regclass('public.custom_agent_profiles') IS NULL",
  'ADD COLUMN IF NOT EXISTS spirit text',
  'ADD COLUMN IF NOT EXISTS spirit_emoji text',
  'ALTER TABLE public.circle_office_agents ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.custom_agent_profiles ENABLE ROW LEVEL SECURITY',
  'CREATE OR REPLACE FUNCTION public.set_published_agent_spirit_v1(',
  'RETURNS jsonb',
  'SECURITY DEFINER',
  "SET search_path = ''",
  'v_actor_id uuid := auth.uid()',
  "RAISE EXCEPTION 'authentication_required'",
  'pg_catalog.char_length(p_spirit_id) NOT BETWEEN 1 AND 200',
  'pg_catalog.char_length(p_spirit_emoji) NOT BETWEEN 1 AND 64',
  'FROM public.circle_members AS membership',
  'membership.circle_id = p_circle_id',
  'membership.user_id = v_actor_id',
  'FROM public.circle_office_agents AS office_agent',
  'office_agent.id = p_office_agent_id',
  'office_agent.circle_id = p_circle_id',
  'office_agent.owner_id = v_actor_id',
  'office_agent.is_published IS TRUE',
  'FOR UPDATE;',
  "p_spirit_id <> 'custom::' || p_custom_profile_id::text",
  'FROM public.custom_agent_profiles AS profile',
  'profile.user_id = v_actor_id',
  'SET spirit = v_spirit_id',
  'GET DIAGNOSTICS v_office_row_count = ROW_COUNT',
  "RAISE EXCEPTION 'agent_spirit_office_row_conflict'",
  'INSERT INTO public.agent_identities AS identity_row',
  'ON CONFLICT (user_id, session_key) DO UPDATE',
  'SET spirit_id = EXCLUDED.spirit_id',
  'GET DIAGNOSTICS v_identity_row_count = ROW_COUNT',
  "RAISE EXCEPTION 'agent_spirit_identity_row_conflict'",
  "'schemaVersion', 1",
  "'officeRowCount', v_office_row_count",
  "'identityRowCount', v_identity_row_count",
  "'officeAgent', v_office_row",
  "'identity', v_identity_row",
  'pg_catalog.pg_column_size(v_receipt) > 4194304',
  'CREATE OR REPLACE FUNCTION public.delete_unreferenced_custom_agent_profile_v1(',
  'SELECT pg_catalog.to_jsonb(profile)',
  'FROM public.custom_agent_profiles AS profile',
  'FOR UPDATE;',
  "identity_row.custom_profile_id = p_profile_id::text",
  "identity_row.spirit_id = 'custom::' || p_profile_id::text",
  "office_agent.spirit = 'custom::' || p_profile_id::text",
  "RAISE EXCEPTION 'custom_agent_profile_still_referenced'",
  'DELETE FROM public.custom_agent_profiles AS profile',
  "'deletedRowCount', v_deleted_row_count",
  'pg_catalog.pg_column_size(v_receipt) > 1048576',
  'CREATE OR REPLACE FUNCTION public.guard_circle_office_agent_spirit_columns_v1()',
  'CREATE OR REPLACE FUNCTION public.guard_published_agent_identity_spirit_columns_v1()',
  'pg_catalog.pg_advisory_xact_lock(',
  "NEW.owner_id::text || ':' || NEW.id::text",
  "NEW.user_id::text || ':' || NEW.session_key",
  '714071348::bigint',
  "RAISE EXCEPTION 'published_agent_spirit_rpc_required'",
  'CREATE TRIGGER circle_office_agent_spirit_columns_guard',
  'BEFORE INSERT OR UPDATE OF id, circle_id, owner_id, spirit, spirit_emoji, is_published',
  'NEW.id IS DISTINCT FROM OLD.id',
  'NEW.owner_id IS DISTINCT FROM OLD.owner_id',
  'NEW.circle_id IS DISTINCT FROM OLD.circle_id',
  'identity_row.session_key = NEW.id::text',
  'CREATE TRIGGER published_agent_identity_spirit_columns_guard',
  'BEFORE INSERT OR DELETE OR UPDATE OF user_id, session_key, spirit_id, spirit_emoji, custom_profile_id, custom_profile_name',
  "IF TG_OP = 'DELETE' THEN",
  'RETURN OLD;',
  'NEW.session_key IS DISTINCT FROM OLD.session_key',
  'NEW.user_id IS DISTINCT FROM OLD.user_id',
  'v_old_is_published_projection boolean := false',
  'v_new_projection_lock bigint',
  'v_old_projection_lock bigint',
  'FROM public.circle_office_agents AS office_agent',
  'office_agent.id = NEW.session_key::uuid',
  'office_agent.id = OLD.session_key::uuid',
  'office_agent.owner_id = NEW.user_id',
  'office_agent.is_published IS TRUE',
  'v_custom_profile_uuid uuid',
  'NEW.custom_profile_id OPERATOR(pg_catalog.~)',
  "NEW.spirit_id IS DISTINCT FROM\n       'custom::' || v_custom_profile_uuid::text",
  'profile.id = v_custom_profile_uuid',
  'profile.user_id = NEW.user_id',
  "RAISE EXCEPTION 'agent_spirit_custom_profile_mismatch'",
  "RAISE EXCEPTION 'agent_spirit_custom_profile_ownership_required'",
  'REVOKE ALL ON FUNCTION public.guard_circle_office_agent_spirit_columns_v1()',
  'REVOKE ALL ON FUNCTION public.guard_published_agent_identity_spirit_columns_v1()',
  'REVOKE ALL ON FUNCTION public.set_published_agent_spirit_v1(uuid, uuid, text, text, uuid)',
  'FROM PUBLIC, anon, authenticated, service_role',
  'GRANT EXECUTE ON FUNCTION public.set_published_agent_spirit_v1(uuid, uuid, text, text, uuid)\n  TO authenticated',
  'GRANT EXECUTE ON FUNCTION public.delete_unreferenced_custom_agent_profile_v1(uuid)\n  TO authenticated',
  'REVOKE DELETE ON TABLE public.custom_agent_profiles FROM authenticated',
  'COMMIT;',
  "NOTIFY pgrst, 'reload schema';",
]) {
  check(migration.includes(marker), `migration pins ${marker}`);
}
check(
  !/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON\s+(?:TABLE\s+)?public\.(?:circle_office_agents|agent_identities|circle_members|custom_agent_profiles)/iu.test(migration),
  'migration never widens direct table privileges',
);

const functionBody = sourceSection(
  migration,
  'CREATE OR REPLACE FUNCTION public.set_published_agent_spirit_v1(',
  'REVOKE ALL ON FUNCTION public.set_published_agent_spirit_v1(uuid, uuid, text, text, uuid)',
);
for (const unqualifiedRelation of [
  'FROM circle_members',
  'FROM circle_office_agents',
  'UPDATE circle_office_agents',
  'FROM custom_agent_profiles',
  'INSERT INTO agent_identities',
]) {
  check(!functionBody.includes(unqualifiedRelation), `definer body rejects ${unqualifiedRelation}`);
}
check(!functionBody.includes('SET search_path = public'), 'definer body never resolves through public search_path');
const membershipAt = functionBody.indexOf('FROM public.circle_members AS membership');
const officeLockAt = functionBody.indexOf('FROM public.circle_office_agents AS office_agent');
const profileAt = functionBody.indexOf('FROM public.custom_agent_profiles AS profile');
const publicWriteAt = functionBody.indexOf('UPDATE public.circle_office_agents AS office_agent');
const identityWriteAt = functionBody.indexOf('INSERT INTO public.agent_identities AS identity_row');
const receiptAt = functionBody.indexOf('v_receipt := pg_catalog.jsonb_build_object(');
check(
  membershipAt >= 0
    && officeLockAt > membershipAt
    && profileAt > officeLockAt
    && publicWriteAt > profileAt
    && identityWriteAt > publicWriteAt
    && receiptAt > identityWriteAt,
  'membership, exact row lock, custom ownership, both writes, and receipt remain transaction-ordered',
);

const identitySpiritGuard = sourceSection(
  migration,
  'CREATE OR REPLACE FUNCTION public.guard_published_agent_identity_spirit_columns_v1()',
  'DROP TRIGGER IF EXISTS circle_office_agent_spirit_columns_guard',
);
const publishedProjectionCheckAt = identitySpiritGuard.indexOf('IF v_is_published_projection OR v_old_is_published_projection THEN');
const privateProfileLockAt = identitySpiritGuard.indexOf('FROM public.custom_agent_profiles AS profile');
for (const marker of [
  'NEW.custom_profile_id IS NULL',
  "pg_catalog.left(NEW.spirit_id, 8) = 'custom::'",
  'NEW.custom_profile_id OPERATOR(pg_catalog.~)',
  "NEW.spirit_id IS DISTINCT FROM\n       'custom::' || v_custom_profile_uuid::text",
  'profile.id = v_custom_profile_uuid',
  'profile.user_id = NEW.user_id',
  'FOR KEY SHARE;',
  'NEW.custom_profile_name IS DISTINCT FROM v_expected_profile_name',
  'NEW.spirit_emoji IS DISTINCT FROM v_expected_profile_emoji',
]) {
  check(identitySpiritGuard.includes(marker), `private custom Spirit guard pins ${marker}`);
}
check(
  publishedProjectionCheckAt >= 0 && privateProfileLockAt > publishedProjectionCheckAt,
  'private custom profile validation and key-share lock follow the published-projection rejection',
);

const parser = sourceSection(
  identityRuntime,
  'function parsePublishedAgentSpiritRpcReceipt(',
  'function agentIdentityExactServerWriteMode(',
);
for (const marker of [
  'receipt.schemaVersion !== 1',
  'receipt.userId !== authority.userId',
  'receipt.circleId !== authority.circleId',
  'receipt.officeAgentId !== input.officeAgentId',
  'receipt.sessionKey !== input.sessionKey',
  'receipt.officeRowCount !== 1',
  'receipt.identityRowCount !== 1',
  'officeRow.circle_id !== authority.circleId',
  'officeRow.owner_id !== authority.userId',
  'officeRow.is_published !== true',
  'identityRow.user_id !== authority.userId',
  'identityRow.session_key !== input.sessionKey',
  'identityRow.is_customized !== true',
  'parseExactAgentIdentityCache(',
]) {
  check(parser.includes(marker), `receipt validator pins ${marker}`);
}

const exactWriter = sourceSection(
  identityRuntime,
  'export async function updatePublishedAgentSpiritExact(',
  '// ─── Record Agent Activity',
);
for (const marker of [
  'officeAgentId !== officeAgentId.toLowerCase()',
  'sessionKey !== officeAgentId',
  "beginAgentIdentityExactCommand('published_spirit', authority, officeAgentId)",
  'verifyAgentIdentityExactAuthority(authority, commandFence)',
  ".rpc('set_published_agent_spirit_v1'",
  'p_circle_id: verifiedAuthority.circleId',
  'p_office_agent_id: officeAgentId',
  ".setHeader('Authorization', `Bearer ${verifiedAuthority.accessToken}`)",
  'parsePublishedAgentSpiritRpcReceipt(',
  "serverSaved: null, error: 'outcome_unknown'",
  "error: 'mutation_superseded'",
  'publishCurrentAgentIdentityServerTruthExact(',
]) {
  check(exactWriter.includes(marker), `exact writer pins ${marker}`);
}
check((exactWriter.match(/isAgentIdentityExactAuthorityCurrent\(/gu) || []).length >= 6, 'exact writer fences every remote and publication-handoff await boundary');
check(!exactWriter.includes(".from('circle_office_agents')") && !exactWriter.includes(".from('agent_identities')"), 'runtime has one RPC and no split table writer');
check(exactWriter.indexOf('parsePublishedAgentSpiritRpcReceipt(') < exactWriter.indexOf('publishCurrentAgentIdentityServerTruthExact('), 'validated receipt precedes cross-realm server-truth publication');

const exactDelete = sourceSection(
  identityRuntime,
  'export async function deleteUnreferencedCustomAgentProfileExact(',
  '// ─── Record Agent Activity',
);
for (const marker of [
  "beginAgentIdentityExactCommand('profile_delete', authority, profileId)",
  'verifyAgentIdentityExactAuthority(authority, commandFence)',
  ".rpc('delete_unreferenced_custom_agent_profile_v1'",
  'p_profile_id: profileId',
  ".setHeader('Authorization', `Bearer ${verifiedAuthority.accessToken}`)",
  "errorMessage.includes('custom_agent_profile_still_referenced')",
  "error: 'profile_referenced'",
  'parseCustomProfileDeleteRpcReceipt(data, verifiedAuthority, profileId)',
  "serverDeleted: null, error: 'outcome_unknown'",
]) {
  check(exactDelete.includes(marker), `exact profile delete pins ${marker}`);
}
check((exactDelete.match(/isAgentIdentityExactAuthorityCurrent\(/gu) || []).length >= 5, 'profile delete fences verification, RPC, receipt, and retirement');

const persistPanel = sourceSection(
  spiritPanel,
  'const persistSpiritSelection = useCallback(',
  'useEffect(() => {\n    setDbAgentLink(null)',
);
for (const marker of [
  'spiritAssignmentBusyRef.current',
  'setSpiritAssignmentBusy(true)',
  'updatePublishedAgentSpiritExact({',
  'receipt.ok',
  'receipt.localSaved',
  'receipt.serverSaved',
  "receipt.error === 'outcome_unknown'",
  'Refresh this Spirit before retrying.',
  'ERROR: Spirit assignment was not saved. Check the connection and try again.',
  'WARNING: Spirit was saved on the server, but this view could not refresh. Reload the Spirit panel.',
]) {
  check(persistPanel.includes(marker), `Spirit UI pins ${marker}`);
}
check(!persistPanel.includes(".from('circle_office_agents')") && !persistPanel.includes('updateAgentSpirit('), 'Spirit assignment has no split or ambient public writer');
check(spiritPanel.includes('accessibilityLiveRegion="polite"') && spiritPanel.includes('Saving verified Spirit assignment…'), 'Spirit assignment exposes an accessible busy/result live region');
check(spiritPanel.includes('disabled={spiritAssignmentBusy}'), 'Spirit assignment controls disable during the single-flight mutation');

for (const marker of [
  'psql_smoke -f "$migration" >/dev/null\n# Consolidated SQL replay must remain safe.\npsql_smoke -f "$migration"',
  'Spirit RPC is not SECURITY DEFINER with an empty search_path',
  'Spirit RPC grants are not authenticated-only',
  '$zero_identity$',
  '$existing_identity$',
  '$custom_profile$',
  '$direct_projection_guards$',
  'direct public Spirit projection update was accepted',
  'direct public Spirit projection insert was accepted',
  'private-Spirit preseed followed by public insert was accepted',
  'direct publication of a prefilled Spirit projection was accepted',
  'direct published identity Spirit update was accepted',
  'direct published identity Spirit insert was accepted',
  'direct published identity projection delete was accepted',
  "session_key='private-delete-allowed'",
  'private identity key was retargeted into a published projection',
  'published Office key was retargeted onto a private identity',
  'nonsensitive or private live-session writes were blocked',
  'incoherent private custom Spirit assignment was accepted',
  'foreign-owner private custom Spirit assignment was accepted',
  'private custom Spirit without a profile id was accepted',
  '$direct_insert_race_truth$',
  'private Spirit insert bypassed a racing public projection',
  'public insert bypassed a racing private Spirit projection',
  '$non_member$',
  '$non_owner$',
  '$foreign_profile$',
  '$referenced_profile_delete$',
  '$unreferenced_profile_delete$',
  '$foreign_profile_delete$',
  '$rollback_after_public_write$',
  '$concurrent_final_truth$',
  '$assign_delete_concurrent_truth$',
  'assignment-first race receipt was not exact',
  'delete-first race receipt was not exact',
  'pause_private_profile_delete_for_smoke',
  'private assignment bypassed a paused profile delete',
  "session_key='private-delete-race-session'",
]) {
  check(behaviorSmoke.includes(marker), `behavior smoke proves ${marker}`);
}

const expectedScripts: Record<string, string> = {
  'smoke:agent-spirit-assignment-rpc-sql': 'npx tsx scripts/agent-spirit-assignment-rpc-sql-smoketest.ts',
  'smoke:agent-spirit-assignment-rpc-sql-behavior': 'sh scripts/agent-spirit-assignment-rpc-sql-behavior-smoketest.sh',
};
for (const [name, command] of Object.entries(expectedScripts)) {
  assertions += 1;
  assert.equal(packageJson.scripts?.[name], command, `package exposes ${name}`);
}
const aggregate = packageJson.scripts?.['check:office-addons'] || '';
check(aggregate.includes('npm run smoke:agent-spirit-assignment-rpc-sql'), 'default Office gate includes static §48 proof');
check(!aggregate.includes('npm run smoke:agent-spirit-assignment-rpc-sql-behavior'), 'default Office gate does not require local PostgreSQL');

for (const [document, name] of [[roadmap, 'roadmap'], [stackReference, 'stack reference'], [claude, 'CLAUDE']] as const) {
  check(document.includes('20260817140000_agent_spirit_assignment_rpc.sql'), `${name} names the §48 migration`);
  check(document.includes('§48'), `${name} records consolidated section §48`);
}
check(roadmap.includes('| 48 | Atomic published-agent Spirit projection'), 'roadmap SQL checklist records §48');
const roadmapSection48 = roadmap.split(/\r?\n/u).find(line => line.startsWith('| 48 | Atomic published-agent Spirit projection'));
check(roadmapSection48?.includes('**Pending / not applied.**'), 'roadmap separates source proof from deployment proof');

console.log(`Agent Spirit assignment RPC SQL smoke passed (${assertions} assertions).`);
