/**
 * Static security contract for the emergency circle access migration.
 *
 * Run: npx tsx scripts/circle-public-access-emergency-security-smoketest.ts
 */

import { readFileSync } from 'node:fs';

const migrationPath =
  'supabase/migrations/20260806172000_circle_public_access_emergency_hardening.sql';
const migration = readFileSync(migrationPath, 'utf8');
let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function section(start: string, end: string): string {
  const startAt = migration.indexOf(start);
  const endAt = migration.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `section starts: ${start}`);
  assert(endAt > startAt, `section ends: ${end}`);
  return migration.slice(startAt, endAt);
}

function returnShape(functionSource: string): string {
  const startAt = functionSource.indexOf('RETURNS TABLE (');
  const endAt = functionSource.indexOf('\n)\nLANGUAGE', startAt);
  assert(startAt >= 0 && endAt > startAt, 'RPC has an explicit table return shape');
  return functionSource.slice(startAt, endAt);
}

console.log('Raw circle and invite boundaries');
assert(migration.includes('ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false'), 'public discovery is explicit and defaults private');
assert(
  migration.includes("tablename = 'circles'")
    && migration.includes("AND cmd = 'SELECT'")
    && migration.includes("'DROP POLICY %I ON public.circles'"),
  'every prior circles SELECT policy is removed before replacement',
);
const circlePolicy = section(
  'CREATE POLICY "Authenticated members and creators can view circles"',
  '-- A public/anon table grant defeats',
);
assert(circlePolicy.includes('TO authenticated'), 'raw circle reads are authenticated-only');
assert(circlePolicy.includes('created_by = auth.uid()'), 'circle creators retain raw-row access');
assert(circlePolicy.includes('public.user_is_circle_member(id)'), 'circle members retain raw-row access through the non-recursive helper');
assert(!circlePolicy.includes('is_public'), 'public status never exposes raw circle rows');
assert(!circlePolicy.includes('USING (true)'), 'strict circle policy is never universally readable');
assert(migration.includes('REVOKE SELECT ON TABLE public.circles FROM PUBLIC'), 'PUBLIC loses raw circle SELECT');
assert(migration.includes('REVOKE SELECT ON TABLE public.circles FROM anon'), 'anon loses raw circle SELECT');
assert(migration.includes('GRANT SELECT ON TABLE public.circles TO authenticated'), 'signed-in member screens retain RLS-constrained circle SELECT');
assert(
  migration.includes("tablename = 'circle_invites'")
    && migration.includes("AND cmd = 'SELECT'")
    && migration.includes("'DROP POLICY %I ON public.circle_invites'"),
  'every enumerable SELECT-only invite policy is removed regardless of historical name',
);
assert(migration.includes('circle_invites_manage') && migration.includes('FOR ALL policy is intentionally'), 'scoped invite management policy is intentionally preserved');
assert(migration.includes('REVOKE SELECT ON TABLE public.circle_invites FROM PUBLIC'), 'PUBLIC cannot enumerate invite rows');
assert(migration.includes('REVOKE SELECT ON TABLE public.circle_invites FROM anon'), 'anon cannot enumerate invite rows');

console.log('Direct membership compatibility policy');
assert(
  migration.includes("tablename = 'circle_members'")
    && migration.includes("AND cmd IN ('INSERT', 'ALL')")
    && migration.includes("'DROP POLICY %I ON public.circle_members'"),
  'legacy INSERT and creator FOR ALL policies cannot bypass the replacement',
);
const insertPolicy = section(
  'CREATE POLICY "Users can bootstrap or join public circles"',
  'CREATE POLICY "Circle creators can update members"',
);
assert(insertPolicy.includes('FOR INSERT') && insertPolicy.includes('TO authenticated'), 'direct membership insert is authenticated-only');
assert(insertPolicy.includes('user_id = auth.uid()'), 'direct membership insert is self-only');
assert(insertPolicy.includes("role = 'creator'"), 'creator bootstrap uses the creator role exactly');
assert(insertPolicy.includes('public.current_user_created_circle(circle_id)'), 'creator bootstrap is bound to the created circle');
assert(insertPolicy.includes("role = 'member'"), 'public self-join uses the member role exactly');
assert(insertPolicy.includes('public.public_circle_join_is_available(circle_id)'), 'public self-join is availability and capacity checked');
assert(!insertPolicy.includes("role = 'admin'"), 'direct membership insert cannot self-assign admin');
assert(!insertPolicy.includes("role = 'moderator'"), 'direct membership insert cannot self-assign moderator');

for (const helperName of [
  'current_user_created_circle',
  'public_circle_join_is_available',
]) {
  const helper = section(
    `CREATE OR REPLACE FUNCTION public.${helperName}`,
    `REVOKE ALL ON FUNCTION public.${helperName}`,
  );
  assert(helper.includes('SECURITY DEFINER'), `${helperName} deliberately bypasses recursive caller RLS`);
  assert(helper.includes('SET search_path = pg_catalog, public'), `${helperName} has a fixed search path`);
  assert(migration.includes(`REVOKE ALL ON FUNCTION public.${helperName}(uuid) FROM PUBLIC`), `${helperName} is not PUBLIC-executable`);
  assert(migration.includes(`REVOKE ALL ON FUNCTION public.${helperName}(uuid) FROM anon`), `${helperName} is not anon-executable`);
  assert(migration.includes(`GRANT EXECUTE ON FUNCTION public.${helperName}(uuid) TO authenticated`), `${helperName} is available only where its RLS policy needs it`);
}
const capacityHelper = section(
  'CREATE OR REPLACE FUNCTION public.public_circle_join_is_available',
  'REVOKE ALL ON FUNCTION public.current_user_created_circle',
);
assert(capacityHelper.includes('FOR UPDATE'), 'direct public joins serialize on the circle row');
assert(capacityHelper.includes('selected_is_public IS NOT TRUE'), 'direct public joins require explicit publication');
assert(capacityHelper.includes('selected_member_count < greatest(coalesce(selected_max_members, 8), 1)'), 'direct public joins enforce max_members');

console.log('Safe RPC projections and execution grants');
const discover = section(
  'CREATE OR REPLACE FUNCTION public.discover_public_circles',
  '-- Capacity-checked, idempotent public-circle join',
);
const publicJoin = section(
  'CREATE OR REPLACE FUNCTION public.join_public_circle',
  '-- Invite-code joins accept both',
);
const inviteJoin = section(
  'CREATE OR REPLACE FUNCTION public.join_circle_by_invite_code',
  'REVOKE ALL ON FUNCTION public.discover_public_circles',
);

for (const [name, rpc] of [
  ['discover_public_circles', discover],
  ['join_public_circle', publicJoin],
  ['join_circle_by_invite_code', inviteJoin],
] as const) {
  assert(rpc.includes('SECURITY DEFINER'), `${name} uses the deliberate server-side authorization boundary`);
  assert(rpc.includes('SET search_path = pg_catalog, public'), `${name} has a fixed search path`);
  assert(rpc.includes("caller_id uuid := auth.uid()"), `${name} derives identity from the verified JWT`);
  assert(rpc.includes("MESSAGE = 'authentication_required'"), `${name} fails closed without a user`);
  const shape = returnShape(rpc);
  for (const secretField of [
    'invite_code',
    'api_key',
    'settings',
    'discord_bot_token',
    'discord_webhook_url',
    'tab_visibility',
  ]) {
    assert(!shape.includes(secretField), `${name} never returns ${secretField}`);
  }
}

assert(discover.includes('circle.is_public IS TRUE'), 'discovery only returns opted-in public circles');
assert(discover.includes('80'), 'discovery search input is bounded');
assert(discover.includes('greatest(coalesce(p_limit, 50), 1)') && discover.includes('50'), 'discovery page size is clamped to 1..50');
assert(discover.includes('greatest(coalesce(p_offset, 0), 0)') && discover.includes('500'), 'discovery offset is clamped to 0..500');
assert(discover.includes('normalized_search =') && discover.includes('pg_catalog.strpos'), 'discovery treats search as bounded literal text rather than a wildcard program');

assert(publicJoin.includes('FOR UPDATE'), 'public join serializes on the circle row');
assert(publicJoin.includes('selected_is_public IS NOT TRUE'), 'public join rejects private circles');
assert(publicJoin.includes("VALUES (p_circle_id, caller_id, 'member')"), 'public join inserts the exact caller as member');
assert(publicJoin.includes('selected_member_count >= greatest('), 'public join enforces max_members');
assert(publicJoin.includes('was_already_member := true'), 'public join is idempotent for existing members');

assert(inviteJoin.includes('pg_catalog.lower(') && inviteJoin.includes('pg_catalog.btrim('), 'invite codes are normalized');
assert(inviteJoin.includes('pg_catalog.length(normalized_code) < 4') && inviteJoin.includes('pg_catalog.length(normalized_code) > 64'), 'invite codes have strict length bounds');
assert(inviteJoin.includes("normalized_code !~ '^[a-z0-9_-]+$'"), 'invite codes use a narrow character set');
assert(inviteJoin.includes("invite.status = 'pending'"), 'managed invites must be pending');
assert(inviteJoin.includes('invite.expires_at > pg_catalog.now()'), 'managed invites must be unexpired');
assert(inviteJoin.includes('invite.use_count < invite.max_uses'), 'managed invites enforce usage limits');
assert(inviteJoin.includes("selected_invite_type = 'email'"), 'email invites are recognized');
assert(inviteJoin.includes('selected_invite_email') && inviteJoin.includes('caller_email'), 'email invites bind to the JWT email');
assert(inviteJoin.includes("VALUES (selected_circle_id, caller_id, desired_role)"), 'invite join inserts only the authenticated caller with server-selected role');
assert(inviteJoin.includes('selected_member_count >= greatest('), 'invite join enforces max_members');
assert(inviteJoin.includes('invite.use_count + 1'), 'managed invite consumption is atomic');
assert(inviteJoin.includes('was_already_member := true'), 'invite join is idempotent for existing members');

for (const signature of [
  'discover_public_circles(text, integer, integer)',
  'join_public_circle(uuid)',
  'join_circle_by_invite_code(text)',
]) {
  assert(migration.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC`), `${signature} is not PUBLIC-executable`);
  assert(migration.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM anon`), `${signature} is not anon-executable`);
  assert(migration.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`), `${signature} is authenticated-only`);
  assert(!migration.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO anon`), `${signature} is never granted to anon`);
}

console.log('View invoker boundary');
const expectedViews = [
  'memory_embedding_coverage',
  'memory_maintenance_recent',
  'memory_soul_coverage',
  'memory_with_souls',
  'soul_wisdom_staleness',
  'training_safe_automations',
  'training_safe_github_events',
  'training_safe_goals',
  'training_safe_mission_agents',
  'training_safe_mission_tasks',
  'training_safe_missions',
  'training_safe_proof_of_work',
  'training_safe_tasks',
];
for (const view of expectedViews) {
  assert(migration.includes(`'${view}'`), `fixed security_invoker list includes ${view}`);
}
assert(migration.includes("'ALTER VIEW public.%I SET (security_invoker = true)'"), 'listed views execute with caller RLS');
assert(migration.includes("pg_catalog.to_regclass("), 'view hardening is safe when a variant omits a listed view');

assert(migration.includes("NOTIFY pgrst, 'reload schema'"), 'PostgREST is asked to refresh RPC and policy metadata');
assert(migration.includes('BEGIN;') && migration.includes('COMMIT;'), 'emergency hardening is atomic');

console.log(`\ncircle-public-access-emergency-security-smoketest: ${assertions} assertions passed.`);
