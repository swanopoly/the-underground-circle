/**
 * Contract guard for the forward repair that restores atomic creator + Chat
 * bootstrap on newly inserted circles.
 */

import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve('supabase/migrations/20260807143000_restore_circle_creator_chat_bootstrap_trigger.sql'),
  'utf8',
);

let assertions = 0;
function assert(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const normalized = migration.replace(/\s+/g, ' ').trim();
const creatorMembershipInsert = normalized.indexOf(
  'INSERT INTO public.circle_members (circle_id, user_id, role)',
);
const visibleThreadInsert = normalized.indexOf(
  'INSERT INTO public.circle_chat_threads ( circle_id, created_by, title, visibility, default_model )',
);

assert(/^--[\s\S]*\bBEGIN;[\s\S]*COMMIT;\s*$/i.test(migration), 'migration is one atomic transaction');
assert(
  migration.includes('DROP TRIGGER IF EXISTS trg_add_creator_as_member ON public.circles;'),
  'reruns replace the canonical trigger instead of duplicating it',
);
assert(migration.includes('CREATE TRIGGER trg_add_creator_as_member'), 'canonical trigger is recreated');
assert(/AFTER\s+INSERT\s+ON\s+public\.circles/i.test(migration), 'trigger runs only after a circle insert');
assert(/FOR\s+EACH\s+ROW/i.test(migration), 'each new circle is bootstrapped');
assert(
  /EXECUTE\s+FUNCTION\s+public\.add_creator_as_member\(\)/i.test(migration),
  'trigger delegates to the canonical bootstrap function',
);
assert(
  !/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.add_creator_as_member/i.test(migration),
  'repair does not overwrite the canonical trigger function',
);

assert(creatorMembershipInsert >= 0, 'repair inserts creator membership rows');
assert(
  normalized.includes("SELECT circle.id, circle.created_by, 'creator' FROM public.circles AS circle"),
  'membership repair uses the accepted creator role and canonical owner',
);
assert(
  /FROM public\.circle_members AS membership\s+WHERE membership\.circle_id = circle\.id\s+AND membership\.user_id = circle\.created_by/i.test(normalized),
  'membership repair is scoped to an exact missing circle and creator pair',
);
assert(
  normalized.includes('ON CONFLICT (circle_id, user_id) DO NOTHING;'),
  'membership repair remains race-safe and idempotent',
);
assert(!/DO\s+UPDATE\s+SET\s+role/i.test(migration), 'existing member roles are not rewritten');

assert(visibleThreadInsert > creatorMembershipInsert, 'creator membership is repaired before its Chat thread');
assert(
  normalized.includes("circle.created_by, 'Circle Chat', 'circle', 'claude-sonnet-4-6'"),
  'missing thread repair creates the current Sonnet-backed circle-visible Chat thread',
);
assert(
  /FROM public\.circle_chat_threads AS thread\s+WHERE thread\.circle_id = circle\.id\s+AND thread\.visibility = 'circle'/i.test(normalized),
  'thread repair is limited to circles missing their circle-visible thread',
);
assert(/ON\s+CONFLICT\s+DO\s+NOTHING;\s+COMMIT;/i.test(normalized), 'thread repair is race-safe and rerunnable');
assert(!/\bUPDATE\s+public\./i.test(migration), 'repair does not mutate existing application rows');
assert(!/\bDELETE\s+FROM\s+public\./i.test(migration), 'repair never deletes application rows');

console.log(`circle-bootstrap-trigger-restoration-smoketest: ${assertions} assertions passed`);
