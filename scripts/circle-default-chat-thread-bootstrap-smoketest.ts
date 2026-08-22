/** Regression guard for automatic default Chat-thread provisioning. */

import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve('supabase/migrations/20260806194000_circle_default_chat_thread_bootstrap.sql'),
  'utf8',
);
const chatTab = fs.readFileSync(
  path.resolve('src/screens/circles/tabs/ChatTab.tsx'),
  'utf8',
);

let assertions = 0;
function assert(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

assert(/BEGIN;[\s\S]*COMMIT;/i.test(migration), 'migration is atomic');
assert(migration.includes('CREATE OR REPLACE FUNCTION public.add_creator_as_member()'), 'existing atomic circle trigger is extended');
assert(migration.includes("VALUES (NEW.id, NEW.created_by, 'creator')"), 'creator membership remains atomic');
assert(migration.includes('INSERT INTO public.circle_chat_threads'), 'new circles receive a Chat thread');
assert(migration.includes("'Circle Chat'"), 'default thread has a stable title');
assert(migration.includes("'circle'"), 'default thread is circle-visible');
assert(migration.includes("'auto'"), 'default thread uses automatic model routing');
assert(migration.includes('WHERE NOT EXISTS'), 'historical repair is idempotent');
assert(migration.includes('message.thread_id IS NULL'), 'legacy messages are attached without moving existing threaded messages');
assert(migration.includes('SET search_path = pg_catalog, public, extensions'), 'security-definer search path remains fixed');
assert(migration.includes('REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM authenticated'), 'trigger cannot be invoked directly by a signed-in browser');
assert(chatTab.includes('getCircleDefaultThread(scopedCircleId)'), 'Chat resolves the database-provisioned default thread');
assert(chatTab.includes("setThreadLoadState({ status: 'ready'"), 'a valid thread enables the composer');

console.log(`circle-default-chat-thread-bootstrap-smoketest: ${assertions} assertions passed`);
