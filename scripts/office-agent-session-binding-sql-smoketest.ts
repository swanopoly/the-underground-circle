/** Static regression contract for §§36/49 owner-private Office/OpenSwan bindings. */

import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260807170000_office_agent_session_bindings.sql',
  'utf8',
);
const casMigration = readFileSync(
  'supabase/migrations/20260818120000_office_agent_session_binding_cas.sql',
  'utf8',
);
const consolidated = readFileSync('docs/RUN_THIS_SQL.sql', 'utf8');
const roadmap = readFileSync('docs/AGENTS_ROADMAP.md', 'utf8');

let assertions = 0;
function check(condition: unknown, label: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`office-agent-session-binding-sql smoke failed: ${label}`);
}

function section(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  check(startIndex >= 0, `missing section ${start}`);
  check(endIndex > startIndex, `missing section terminator ${end}`);
  return migration.slice(startIndex, endIndex);
}

check(/^--[\s\S]*\bBEGIN;[\s\S]*COMMIT;\s*NOTIFY pgrst, 'reload schema';\s*$/i.test(migration), 'migration is one atomic transaction');
check(migration.includes('CREATE TABLE IF NOT EXISTS public.office_agent_session_bindings'), 'creates the canonical private binding table idempotently');
check(migration.includes('UNIQUE (office_agent_id)'), 'one Office agent has at most one binding');
check(migration.includes('UNIQUE (agent_bot_id, session_key)'), 'one provider session cannot masquerade as two Office agents');
check(migration.includes("CHECK (session_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')"), 'session identity has exact safe grammar');
check(!/\b(endpoint|token|api_key|secret)\s+(?:text|jsonb|varchar)\b/i.test(migration), 'binding table stores no endpoint, token, API key, or secret');
check(migration.includes('ALTER TABLE public.office_agent_session_bindings ENABLE ROW LEVEL SECURITY'), 'RLS is enabled');
check(migration.includes('USING (owner_id = (SELECT auth.uid()))'), 'read policy is exact owner-only');
check(migration.includes('DROP POLICY IF EXISTS office_agent_session_bindings_owner_select'), 'read policy can be reapplied safely');
check(migration.includes('REVOKE ALL ON TABLE public.office_agent_session_bindings'), 'direct table mutation authority is revoked');
check(migration.includes('GRANT SELECT ON TABLE public.office_agent_session_bindings'), 'authenticated owners retain RLS-scoped reads');
check(!/FOR\s+(?:INSERT|UPDATE|DELETE|ALL)\s+TO authenticated/i.test(migration), 'there is no authenticated direct-write policy');

const setRpc = section(
  'CREATE OR REPLACE FUNCTION public.set_office_agent_session_binding(',
  'CREATE OR REPLACE FUNCTION public.clear_office_agent_session_binding(',
);
for (const required of [
  'v_uid uuid := auth.uid()',
  'office_agent.owner_id = v_uid',
  "v_office_provider IS DISTINCT FROM 'openswan'",
  'v_office_is_published IS DISTINCT FROM true',
  'agent_bot.owner_id = v_uid',
  "agent_bot.metadata ->> 'provider'",
  "v_bot_provider IS DISTINCT FROM 'openswan'",
  'ON CONFLICT (office_agent_id) DO UPDATE',
  'WHERE binding.owner_id = v_uid',
]) check(setRpc.includes(required), `set RPC enforces ${required}`);

const clearRpc = section(
  'CREATE OR REPLACE FUNCTION public.clear_office_agent_session_binding(',
  '-- Version 2 composes the current canonical claim exactly once',
);
check(clearRpc.includes('office_agent.owner_id = v_uid'), 'clear RPC verifies Office-agent ownership');
check(!clearRpc.includes('v_office_provider'), 'clear RPC remains usable after the public agent provider changes');
check(clearRpc.includes('binding.office_agent_id = p_office_agent_id'), 'clear RPC deletes only the exact binding');
check(clearRpc.includes('binding.owner_id = v_uid'), 'clear RPC also binds deletion to the authenticated owner');

const claimRpc = section(
  'CREATE OR REPLACE FUNCTION public.invoke_agent_v2(',
  'REVOKE ALL ON FUNCTION public.set_office_agent_session_binding',
);
check((claimRpc.match(/FROM public\.invoke_agent\s*\(/g) || []).length === 1, 'v2 calls the canonical claim exactly once');
check(claimRpc.includes('canonical_claim AS MATERIALIZED'), 'canonical claim is materialized once');
check(claimRpc.includes('binding_contract_version integer'), 'claim returns a versioned binding contract');
for (const field of ['binding_id', 'binding_agent_bot_id', 'binding_session_key', 'binding_status']) {
  check(claimRpc.includes(field), `claim returns ${field}`);
}
check(claimRpc.includes("CASE WHEN binding.id IS NULL THEN 'missing'::text ELSE 'bound'::text END"), 'missing binding stays an explicit non-dispatchable state');
check(claimRpc.includes('LEFT JOIN valid_binding'), 'missing binding preserves the canonical response claim');
check(claimRpc.includes('office_agent.owner_id = v_uid'), 'claim snapshot revalidates Office ownership');
check(claimRpc.includes('agent_bot.owner_id = v_uid'), 'claim snapshot revalidates private bot ownership');
check(!/\b(?:ilike|similar to)\b/i.test(claimRpc), 'claim performs no fuzzy identity join');

for (const signature of [
  'set_office_agent_session_binding(uuid, uuid, text)',
  'clear_office_agent_session_binding(uuid)',
  'invoke_agent_v2(uuid, uuid, text, uuid)',
]) {
  check(migration.includes(`REVOKE ALL ON FUNCTION public.${signature}`), `${signature} revokes broad execution`);
  check(migration.includes(`GRANT EXECUTE ON FUNCTION public.${signature}`), `${signature} grants the intended role explicitly`);
}

check(consolidated.includes('-- §36. Owner-private Office agent → OpenSwan session bindings (2026-08-07)'), 'consolidated SQL labels §36');
check(consolidated.split(migration).length === 2, 'consolidated SQL contains one byte-aligned migration copy');
check(roadmap.includes('| 36 | Owner-private Office-agent OpenSwan session bindings'), 'roadmap SQL checklist records §36');
check(
  /\| 36 \| Owner-private Office-agent OpenSwan session bindings[\s\S]*?\| \*\*Applied \/ catalog-ready/.test(roadmap),
  'roadmap preserves the reported applied state of prerequisite §36',
);
check(
  /\| 49 \| Exact Office-agent OpenSwan session-binding compare-and-set[\s\S]*?\| \*\*Pending \/ not applied/.test(roadmap),
  'roadmap keeps the new CAS boundary pending until target deployment',
);

check(/^--[\s\S]*\bBEGIN;[\s\S]*COMMIT;\s*NOTIFY pgrst, 'reload schema';\s*$/i.test(casMigration), 'CAS migration is one atomic transaction');
check(casMigration.includes('CREATE OR REPLACE FUNCTION public.compare_and_set_office_agent_session_binding_v1('), 'forward migration creates one canonical binding CAS RPC');
check(casMigration.includes("SET search_path = ''"), 'CAS RPC pins an empty search path');
for (const parameter of [
  'p_office_agent_id uuid',
  'p_circle_id uuid',
  'p_expected_binding_id uuid',
  'p_expected_agent_bot_id uuid',
  'p_expected_session_key text',
  'p_expected_updated_at timestamptz',
  'p_next_agent_bot_id uuid',
  'p_next_session_key text',
]) check(casMigration.includes(parameter), `CAS RPC carries ${parameter}`);
for (const receiptField of [
  'mutation_contract_version integer',
  'mutation_disposition text',
  'mutation_operation text',
  'observed_binding_id uuid',
  'observed_agent_bot_id uuid',
  'observed_session_key text',
  'observed_updated_at timestamptz',
  'result_binding_id uuid',
  'result_agent_bot_id uuid',
  'result_session_key text',
  'result_updated_at timestamptz',
]) check(casMigration.includes(receiptField), `CAS receipt returns ${receiptField}`);
check(casMigration.includes('v_expected_missing := p_expected_binding_id IS NULL'), 'first bind explicitly expects a missing row');
check(casMigration.includes('AND p_expected_updated_at IS NULL'), 'expected-null first bind includes a null row version');
check(casMigration.includes('office_agent.circle_id = p_circle_id'), 'CAS binds the mutation to the captured Circle');
check(casMigration.includes('office_agent.owner_id = v_uid'), 'CAS binds the mutation to the authenticated owner');
check(/FROM public\.circle_office_agents[\s\S]{0,420}FOR UPDATE;/.test(casMigration), 'Office owner row serializes expected-null first binds');
check(/FROM public\.office_agent_session_bindings[\s\S]{0,420}FOR UPDATE;/.test(casMigration), 'existing private binding is locked before comparison');
for (const expectedField of [
  'v_observed_binding_id = p_expected_binding_id',
  'v_observed_agent_bot_id = p_expected_agent_bot_id',
  'v_observed_session_key = p_expected_session_key',
  'v_observed_updated_at = p_expected_updated_at',
]) check(casMigration.includes(expectedField), `CAS compares ${expectedField}`);
check(casMigration.includes("binding.updated_at + INTERVAL '1 microsecond'"), 'move advances the row version monotonically to reject ABA');
for (const disposition of ["'applied'", "'unchanged'", "'conflict'", "'target_conflict'"]) {
  check(casMigration.includes(`mutation_disposition := ${disposition}`), `CAS returns ${disposition}`);
}
check(casMigration.includes('DELETE FROM public.office_agent_session_bindings'), 'clear executes inside the locked CAS transaction');
check(casMigration.includes('ON CONFLICT DO NOTHING'), 'expected-null insert reports a target conflict instead of overwriting');
check(!casMigration.includes('ON CONFLICT (office_agent_id) DO UPDATE'), 'forward mutation never performs an unconditional upsert');
for (const legacySignature of [
  'set_office_agent_session_binding(uuid, uuid, text)',
  'clear_office_agent_session_binding(uuid)',
]) {
  check(
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${legacySignature.replace(/[()]/g, '\\$&')}[\\s\\S]{0,100}authenticated, service_role`).test(casMigration),
    `${legacySignature} loses authenticated and service-role execution`,
  );
}
check(casMigration.includes('uuid, uuid, uuid, uuid, text, timestamptz, uuid, text'), 'CAS grants and comments use the version-bearing signature');
check(/GRANT EXECUTE ON FUNCTION public\.compare_and_set_office_agent_session_binding_v1\([\s\S]{0,180}\) TO authenticated;/.test(casMigration), 'only authenticated callers receive CAS execution');
check(!/GRANT EXECUTE ON FUNCTION public\.compare_and_set_office_agent_session_binding_v1\([\s\S]{0,180}\) TO [^;]*(?:anon|service_role)/.test(casMigration), 'CAS execution is not granted to anon or service role');
check(consolidated.includes('-- BEGIN SECTION 49: Exact Office-agent session binding compare-and-set'), 'consolidated SQL labels §49');
check(consolidated.split(casMigration).length === 2, 'consolidated SQL contains one byte-aligned CAS migration copy');
check(roadmap.includes('| 49 | Exact Office-agent OpenSwan session-binding compare-and-set'), 'roadmap SQL checklist records §49');

console.log(`office-agent-session-binding-sql smoke: ${assertions} assertions passed`);
