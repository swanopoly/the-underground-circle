/**
 * Static contract for the emergency collaboration-table RLS hardening.
 *
 * This intentionally tests the migration text without needing a database. The
 * release review separately exercises the linked project and anonymous REST
 * API after the migration is applied.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260806_public_collaboration_rls_hardening.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

let assertions = 0;
const check = (condition: boolean, message: string) => {
  assertions += 1;
  if (!condition) throw new Error(`public collaboration RLS smoke failed: ${message}`);
};

const privateTables = [
  'check_ins',
  'pins',
  'profiles',
  'reactions',
  'tasks',
  'user_achievements',
  'votes',
  'xp_events',
];

check(sql.includes('BEGIN;'), 'migration must apply atomically');
check(sql.includes('COMMIT;'), 'migration must commit atomically');
for (const policy of [
  'Circle members can view check-ins',
  'Circle members can view pins',
  'Circle members can view tasks',
  'Circle members can view reactions',
  'Circle members can view check-in votes',
  'Circle peers can view user achievements',
  'Circle peers can view XP events',
]) {
  check(
    sql.includes(`DROP POLICY IF EXISTS "${policy}"`),
    `${policy} must be replaceable on a bounded retry`,
  );
}

for (const table of privateTables) {
  check(
    sql.includes(`REVOKE ALL ON TABLE public.${table} FROM anon;`),
    `${table} must revoke all direct anonymous privileges`,
  );
  check(
    sql.includes(`REVOKE ALL ON TABLE public.${table} FROM authenticated;`),
    `${table} must clear historical blanket authenticated grants before least-privilege grants`,
  );
}

for (const helper of [
  'shares_circle_with_user(uuid)',
  'can_access_reaction_target(uuid, uuid)',
  'can_access_check_in(uuid)',
]) {
  check(
    sql.includes(`REVOKE ALL ON FUNCTION public.${helper} FROM PUBLIC, anon;`),
    `${helper} must not be executable by public or anon`,
  );
  check(
    sql.includes(`GRANT EXECUTE ON FUNCTION public.${helper} TO authenticated;`),
    `${helper} must be restricted to authenticated callers`,
  );
}

check(
  sql.includes('DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;'),
  'world-readable profiles policy must be removed',
);
check(
  sql.includes('USING (public.shares_circle_with_user(id));'),
  'profile reads must require self or shared-circle access',
);
check(
  sql.includes('WITH CHECK (user_id = auth.uid() AND public.user_is_circle_member(circle_id));'),
  'check-in inserts must bind the author and circle membership',
);
check(
  sql.includes('WITH CHECK (created_by = auth.uid() AND public.user_is_circle_member(circle_id));'),
  'task inserts must bind the creator and circle membership',
);
check(
  sql.includes('AND ((p_check_in_id IS NULL) <> (p_message_id IS NULL))'),
  'reactions must have exactly one target type',
);
check(
  sql.includes("USING (target_type = 'check_in' AND public.can_access_check_in(target_id));"),
  'votes must be scoped to an accessible shipped target',
);
check(
  sql.includes('SET search_path = pg_catalog, public'),
  'security-definer helpers must use a fixed search path',
);
check(
  !/CREATE POLICY[^;]+TO\s+(?:PUBLIC|anon)/is.test(sql),
  'new policies must never target PUBLIC or anon',
);
check(sql.includes("NOTIFY pgrst, 'reload schema';"), 'PostgREST schema cache must reload');

console.log(`public collaboration RLS smoke passed (${assertions} assertions)`);
