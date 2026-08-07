/**
 * Static safety contract for the Auth user -> public profile delete cascade.
 *
 * Run: npx tsx scripts/profiles-auth-user-delete-cascade-smoketest.ts
 */

import { readFileSync } from 'node:fs';

const migrationPath =
  'supabase/migrations/20260806191000_profiles_auth_user_delete_cascade.sql';
const migration = readFileSync(migrationPath, 'utf8');
let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`profiles auth-user delete cascade smoke failed: ${message}`);
  console.log(`  ok  ${message}`);
}

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

console.log('Atomic and fail-closed migration boundary');
assert(migration.includes('BEGIN;') && migration.includes('COMMIT;'), 'migration is atomic');
assert(
  migration.includes('LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE'),
  'profile writes and concurrent constraint DDL are serialized',
);
assert(
  migration.includes("pg_catalog.to_regclass('public.profiles')") &&
    migration.includes("pg_catalog.to_regclass('auth.users')"),
  'both FK relations must exist',
);
assert(
  migration.includes("constraint_row.conname = 'profiles_id_fkey'"),
  'the migration targets the exact deployed constraint name',
);
assert(
  migration.includes('named_constraint_count <> 1'),
  'missing or duplicate named constraints fail closed',
);
assert(
  migration.includes("profile_fk.contype <> 'f'") &&
    migration.includes('profile_fk.confrelid <> auth_users_relation'),
  'the existing object must be the expected foreign key and parent relation',
);
assert(
  migration.includes('profile_fk.conkey <> ARRAY[profiles_id_attribute]::smallint[]') &&
    migration.includes('profile_fk.confkey <> ARRAY[auth_users_id_attribute]::smallint[]'),
  'the existing FK must connect only profiles.id to auth.users.id',
);
assert(
  migration.includes("profile_fk.confdeltype NOT IN ('a', 'c')"),
  'only the original NO ACTION or completed CASCADE state is accepted',
);
assert(
  migration.includes("ERRCODE = '55000'") &&
    occurrenceCount(migration, 'RAISE EXCEPTION USING') >= 8,
  'unexpected catalog shapes abort with explicit object-state errors',
);

console.log('Delete cascade with original FK semantics preserved');
assert(
  migration.includes("IF profile_fk.confdeltype = 'a' THEN"),
  'constraint replacement runs only from the expected original state',
);
assert(
  migration.includes('DROP CONSTRAINT profiles_id_fkey') &&
    migration.includes('ADD CONSTRAINT profiles_id_fkey'),
  'the stable constraint name is retained',
);
assert(
  migration.includes('FOREIGN KEY (id)') &&
    migration.includes('REFERENCES auth.users(id)'),
  'the one-to-one profile ownership columns are retained',
);
assert(migration.includes('ON DELETE CASCADE'), 'Auth user deletion cascades to its profile');
assert(migration.includes('ON UPDATE NO ACTION'), 'the original update action is retained');
assert(migration.includes('MATCH SIMPLE'), 'the original match type is retained');
assert(migration.includes('NOT DEFERRABLE'), 'the original immediate constraint timing is retained');
assert(
  occurrenceCount(migration, "profile_fk.confdeltype <> 'c'") === 1,
  'the postcondition requires PostgreSQL CASCADE catalog state',
);
assert(
  occurrenceCount(migration, 'profile_fk.convalidated IS NOT TRUE') >= 2,
  'the FK is validated before and after the change',
);

console.log('Auth signup profile trigger continuity');
assert(
  migration.includes("pg_catalog.to_regprocedure('public.handle_new_user()')"),
  'the existing signup handler is resolved by exact signature',
);
assert(
  migration.includes("profile_handler_row.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype"),
  'the handler must remain a trigger function',
);
assert(migration.includes('profile_handler_row.prosecdef IS NOT TRUE'), 'the Auth handler must retain definer execution');
assert(migration.includes("'insert into profiles'"), 'the Auth handler must still create a public profile');
assert(
  occurrenceCount(migration, "trigger_row.tgname = 'on_auth_user_created'") === 2,
  'the exact signup trigger is checked before and after FK replacement',
);
assert(
  occurrenceCount(migration, 'trigger_row.tgfoid = profile_handler') === 2,
  'the signup trigger remains attached to the existing handler',
);
assert(
  occurrenceCount(migration, 'trigger_row.tgtype = 5') === 2,
  'the signup trigger remains row-level AFTER INSERT',
);
assert(
  occurrenceCount(migration, "trigger_row.tgenabled IN ('O', 'A')") === 2,
  'the signup trigger remains enabled for normal inserts',
);
assert(!/\b(?:CREATE|DROP|ALTER)\s+TRIGGER\b/i.test(migration), 'the migration does not mutate Auth triggers');
assert(
  !/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.handle_new_user/i.test(migration),
  'the migration does not replace signup behavior',
);

console.log('No user-data mutation hidden in the schema repair');
assert(!/\bDELETE\s+FROM\b/i.test(migration), 'the migration does not delete existing rows');
assert(!/\bTRUNCATE\b/i.test(migration), 'the migration does not truncate data');
assert(!/\bDROP\s+TABLE\b/i.test(migration), 'the migration does not drop tables');
assert(!/\b(?:INSERT|UPDATE)\s+(?:INTO\s+)?auth\.users\b/i.test(migration), 'the migration never writes Auth users');

console.log(`\nprofiles-auth-user-delete-cascade-smoketest: ${assertions} assertions passed.`);
