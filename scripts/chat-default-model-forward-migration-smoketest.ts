/**
 * Regression guard for the forward-only Claude Sonnet Chat default.
 *
 * Pins the canonical TypeScript default, the three client-side thread write
 * paths, and the database defaults used for future private/circle threads.
 * Existing rows and an explicitly stored `auto` preference must remain intact.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CHAT_MODEL,
  normalizeThreadModelPreference,
} from '../src/lib/chatSessionTitleCore';

const threadsSource = fs.readFileSync(
  path.resolve('src/lib/circleChatThreads.ts'),
  'utf8',
);
const migration = fs.readFileSync(
  path.resolve('supabase/migrations/20260807120000_chat_default_claude_sonnet.sql'),
  'utf8',
);

let assertions = 0;
function assert(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

assert(DEFAULT_CHAT_MODEL === 'claude-sonnet-4-6', 'canonical Chat default is Claude Sonnet 4.6');
assert(normalizeThreadModelPreference(null) === DEFAULT_CHAT_MODEL, 'unconfigured thread resolves to the canonical default');
assert(normalizeThreadModelPreference('openswan') === DEFAULT_CHAT_MODEL, 'legacy OpenSwan sentinel resolves to the canonical default');
assert(normalizeThreadModelPreference('auto') === 'auto', 'explicit stored auto preference remains explicit auto');

assert(
  threadsSource.includes("import { DEFAULT_CHAT_MODEL } from './chatSessionTitleCore';"),
  'thread writes import the canonical default',
);
assert(threadsSource.includes('p_default_model: DEFAULT_CHAT_MODEL'), 'private-thread RPC receives the canonical default');
assert(threadsSource.includes('default_model: DEFAULT_CHAT_MODEL'), 'direct private-thread fallback receives the canonical default');
assert(
  threadsSource.includes("const nextModel = defaultModel?.trim() || DEFAULT_CHAT_MODEL;"),
  'blank model updates use the canonical default',
);

assert(/BEGIN;[\s\S]*COMMIT;/i.test(migration), 'forward migration is atomic');
assert(
  /ALTER\s+TABLE\s+public\.circle_chat_threads\s+ALTER\s+COLUMN\s+default_model\s+SET\s+DEFAULT\s+'claude-sonnet-4-6'/i.test(migration),
  'table default changes for future rows',
);
assert(
  /p_default_model\s+text\s+DEFAULT\s+'claude-sonnet-4-6'/i.test(migration),
  'private-thread RPC argument defaults to Sonnet',
);
assert(
  /pg_catalog\.btrim\(p_default_model\)[\s\S]*?'claude-sonnet-4-6'/i.test(migration),
  'private-thread RPC blank fallback defaults to Sonnet',
);
assert(
  /CREATE OR REPLACE FUNCTION public\.add_creator_as_member\(\)[\s\S]*?'Circle Chat'[\s\S]*?'circle'[\s\S]*?'claude-sonnet-4-6'/i.test(migration),
  'future circle-visible thread defaults to Sonnet',
);

const fixedSearchPaths = migration.match(/SET search_path = pg_catalog, public, extensions/gi) || [];
assert(fixedSearchPaths.length === 2, 'both SECURITY DEFINER functions keep fixed hardened search paths');
assert(
  /REVOKE ALL ON FUNCTION public\.create_private_chat_thread\(uuid, text, text\)[\s\S]*?FROM PUBLIC, anon, authenticated;/i.test(migration),
  'private-thread RPC starts from a fail-closed ACL',
);
assert(
  /GRANT EXECUTE ON FUNCTION public\.create_private_chat_thread\(uuid, text, text\)[\s\S]*?TO authenticated;/i.test(migration),
  'authenticated callers retain the reviewed private-thread RPC grant',
);
assert(
  /REVOKE ALL ON FUNCTION public\.add_creator_as_member\(\)[\s\S]*?FROM PUBLIC, anon, authenticated;/i.test(migration),
  'trigger function remains unavailable as a browser RPC',
);

assert(!/UPDATE\s+public\.circle_chat_threads/i.test(migration), 'migration does not update existing thread rows');
assert(
  !/INSERT\s+INTO\s+public\.circle_chat_threads[\s\S]*?SELECT/i.test(migration),
  'migration does not backfill existing circles or threads',
);

console.log(`chat-default-model-forward-migration-smoketest: ${assertions} assertions passed`);
