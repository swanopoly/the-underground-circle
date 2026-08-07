/** Regression guard for atomic circle creation plus creator membership. */

import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve('supabase/migrations/20260806193500_circle_creator_membership_alignment.sql'),
  'utf8',
);
const createScreen = fs.readFileSync(
  path.resolve('src/screens/circles/CreateCircleScreen.tsx'),
  'utf8',
);

let assertions = 0;
function assert(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

assert(/BEGIN;[\s\S]*COMMIT;/i.test(migration), 'migration is atomic');
assert(migration.includes('CREATE OR REPLACE FUNCTION public.add_creator_as_member()'), 'canonical trigger function exists');
assert(migration.includes("VALUES (NEW.id, NEW.created_by, 'creator')"), 'trigger writes the accepted creator role');
assert(!migration.includes("NEW.created_by, 'owner'"), 'trigger does not use the rejected owner role');
assert(migration.includes('ON CONFLICT (circle_id, user_id)'), 'creator membership is idempotent');
assert(migration.includes("DO UPDATE SET role = 'creator'"), 'legacy creator memberships are repaired');
assert(migration.includes('SECURITY DEFINER'), 'trigger is not blocked by caller RLS after a valid circle insert');
assert(migration.includes('SET search_path = pg_catalog, public, extensions'), 'security-definer search path is fixed');
assert(migration.includes('REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM PUBLIC'), 'function is not directly public executable');
assert(migration.includes('CREATE TRIGGER trg_add_creator_as_member'), 'circle inserts invoke the membership trigger');
assert(!/from\('circle_members'\)\.insert/s.test(createScreen), 'client does not race the atomic database membership insert');

console.log(`circle-creator-membership-alignment-smoketest: ${assertions} assertions passed`);
